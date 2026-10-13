//! Owned bounded LIVE points execution, separate from durable SQLite writing.
//! The worker owns only PointsService, never AppCore. An executing synchronous
//! award is awaited to completion; cancellation is only reported before admission.
use super::{AwardOptions, PointAction, PointAward, PointsService};
#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
#[cfg(test)]
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

const CAPACITY: usize = 128;
struct AwardJob {
    unique_id: String,
    action: PointAction,
    options: AwardOptions,
    answer: oneshot::Sender<Option<PointAward>>,
}
pub(crate) struct PointsWorkService {
    sender: Mutex<Option<mpsc::Sender<AwardJob>>>,
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
    stopping: CancellationToken,
    /// Test-only: simulates a wedged synchronous SQLite award so shutdown
    /// ladders and stall policies can be exercised deterministically. The
    /// gate always releases when shutdown begins, so a stall can delay
    /// shutdown only by the configured bound — never hang it.
    #[cfg(test)]
    stall_ms: Arc<AtomicU64>,
}
impl PointsWorkService {
    pub(crate) fn new(points: Arc<PointsService>) -> Self {
        let (sender, mut receiver) = mpsc::channel::<AwardJob>(CAPACITY);
        let stopping = CancellationToken::new();
        let stopping_for_worker = stopping.clone();
        #[cfg(test)]
        let stall_ms = Arc::new(AtomicU64::new(0));
        #[cfg(test)]
        let stall_for_worker = Arc::clone(&stall_ms);
        let worker = std::thread::Builder::new()
            .name("live-points".into())
            .spawn(move || {
                while let Some(job) = receiver.blocking_recv() {
                    #[cfg(test)]
                    {
                        let stall = stall_for_worker.load(Ordering::Relaxed);
                        if stall > 0 {
                            let deadline = Instant::now() + Duration::from_millis(stall);
                            while Instant::now() < deadline && !stopping_for_worker.is_cancelled() {
                                std::thread::sleep(Duration::from_millis(5));
                            }
                        }
                    }
                    #[cfg(not(test))]
                    let _ = &stopping_for_worker;
                    // Dropped queued callers never cause delayed effects.
                    if job.answer.is_closed() {
                        continue;
                    }
                    let result = points.award_points(&job.unique_id, job.action, job.options);
                    let _ = job.answer.send(result);
                }
            });
        match worker {
            Ok(worker) => Self {
                sender: Mutex::new(Some(sender)),
                worker: Mutex::new(Some(worker)),
                stopping,
                #[cfg(test)]
                stall_ms,
            },
            Err(error) => {
                tracing::error!(%error, "LIVE points execution worker unavailable");
                Self {
                    sender: Mutex::new(None),
                    worker: Mutex::new(None),
                    stopping,
                    #[cfg(test)]
                    stall_ms,
                }
            }
        }
    }

    /// Test-only: hold the next award inside the worker for up to `duration`
    /// (released earlier if shutdown starts).
    #[cfg(test)]
    pub(crate) fn stall_for_test(&self, duration: Duration) {
        self.stall_ms
            .store(duration.as_millis() as u64, Ordering::SeqCst);
    }
    pub(crate) async fn award(
        &self,
        unique_id: String,
        action: PointAction,
        options: AwardOptions,
    ) -> Result<Option<PointAward>, String> {
        let sender = crate::recover_mutex(&self.sender, "LIVE points sender")
            .clone()
            .ok_or("LIVE points execution stopped")?;
        let permit = tokio::select! {
            biased;
            () = self.stopping.cancelled() => return Err("LIVE points execution stopped before admission".into()),
            permit = sender.reserve() => permit.map_err(|_| "LIVE points execution unavailable")?,
        };
        let (answer, response) = oneshot::channel();
        permit.send(AwardJob {
            unique_id,
            action,
            options,
            answer,
        });
        // No timeout drops a running award. The ordered ingress worker
        // cannot move to a later event while an earlier effect is unresolved.
        response
            .await
            .map_err(|_| "LIVE points execution worker failed".into())
    }
    pub(crate) async fn shutdown(&self) {
        self.stopping.cancel();
        crate::recover_mutex(&self.sender, "LIVE points sender").take();
        let worker = crate::recover_mutex(&self.worker, "LIVE points worker").take();
        if let Some(worker) = worker {
            match tokio::task::spawn_blocking(move || worker.join()).await {
                Ok(Ok(())) => {}
                outcome => tracing::error!(?outcome, "LIVE points worker join failed"),
            }
        }
    }
    pub(crate) fn diagnostics(&self) -> serde_json::Value {
        let sender = crate::recover_mutex(&self.sender, "LIVE points sender");
        serde_json::json!({ "capacity": CAPACITY, "queued": sender.as_ref().map_or(0, |sender| CAPACITY - sender.capacity()), "stopping": self.stopping.is_cancelled(), "available": sender.as_ref().is_some_and(|sender| !sender.is_closed()) })
    }
}
impl Drop for PointsWorkService {
    fn drop(&mut self) {
        self.stopping.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn repeated_workers_join_release_owner_and_apply_exact_order() {
        let points = Arc::new(PointsService::default());
        for _ in 0..128 {
            let worker = PointsWorkService::new(Arc::clone(&points));
            for _ in 0..8 {
                worker
                    .award("viewer".into(), PointAction::Chat, AwardOptions::default())
                    .await
                    .unwrap()
                    .unwrap();
            }
            worker.shutdown().await;
            assert_eq!(Arc::strong_count(&points), 1);
            assert_eq!(worker.diagnostics()["queued"], 0);
            assert!(worker
                .award("viewer".into(), PointAction::Chat, AwardOptions::default())
                .await
                .is_err());
        }
        assert_eq!(points.viewer("viewer").unwrap()["totalChats"], 1024);
    }
}
