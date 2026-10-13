#[cfg(feature = "native-tiktok")]
use super::ingress::{admit_event, run_ingress_worker, INGRESS_QUEUE_CAPACITY};
use crate::*;

impl AppCore {
    #[cfg(feature = "native-tiktok")]
    pub(crate) fn start_live_event_pump(self: &Arc<Self>) {
        if self.live_pump_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let mut receiver = self.live.subscribe();
        let pump_core = Arc::clone(self);
        let lag_core = Arc::clone(self);
        tracing::info!("native TikTok event pump started");
        let shutdown = self.plugin_state.observer_shutdown.clone();
        // The pump only receives and admits: it never awaits processing, so
        // slow points persistence or slow plugins delay the ordered worker,
        // never socket reception. Both tasks are owned and joined here.
        let (sender, ingress_receiver) = tokio::sync::mpsc::channel(INGRESS_QUEUE_CAPACITY);
        let pump_shutdown = shutdown.clone();
        let pump = tokio::spawn(async move {
            loop {
                let event = tokio::select! {
                    biased;
                    () = pump_shutdown.cancelled() => break,
                    event = receiver.recv() => event,
                };
                match event {
                    Ok(event) => {
                        tracing::debug!(
                            kind = client_event_kind(&event),
                            "native TikTok event received"
                        );
                        tokio::select! {
                            biased;
                            () = pump_shutdown.cancelled() => break,
                            () = admit_event(&pump_core, &sender, event) => {},
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                        lag_core.live_ingress.lagged.fetch_add(1, Ordering::Relaxed);
                        lag_core.record_event_gap();
                        tracing::warn!(count, "native TikTok event receiver lagged; analytics and event stream incomplete")
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        tracing::warn!("native TikTok event stream closed");
                        break;
                    }
                }
            }
            // Dropping the sender lets the worker drain and exit.
        });
        let worker_core = Arc::clone(self);
        let worker = tokio::spawn(run_ingress_worker(worker_core, ingress_receiver, shutdown));
        *recover_mutex(&self.live_pump_task, "LIVE pump") = Some(pump);
        *recover_mutex(&self.live_ingress_task, "LIVE ingress worker") = Some(worker);
    }
    #[cfg(not(feature = "native-tiktok"))]
    pub(crate) fn start_live_event_pump(self: &Arc<Self>) {}
    // Live connect/pick moved to the value-returning control operations
    // (`AppCore::live_connect` / `AppCore::live_pick`); every client,
    // including the WebView, funnels through them.
    #[cfg(feature = "persistence")]
    pub(crate) fn current_creator_unique_id(&self) -> Option<String> {
        recover_rwlock_read(&self.connection_context, "connection context")
            .as_ref()
            .map(|context| context.unique_id.clone())
    }
}

#[cfg(all(test, feature = "native-tiktok"))]
mod tests {
    use crate::*;
    struct NoopEmitter;
    impl HostEmitter for NoopEmitter {
        fn emit(&self, _: HostMessage) {}
    }
    #[tokio::test]
    async fn shutdown_releases_idle_live_pump_owner() {
        let core = Arc::new(AppCore::new(Arc::new(NoopEmitter)));
        let baseline = Arc::strong_count(&core);
        let health = core.system_health();
        assert_eq!(health["plugins"]["eventWorkers"], 0);
        assert_eq!(health["plugins"]["outstandingCalls"], 0);
        assert_eq!(health["automationActiveTasks"], 0);
        assert!(health["liveGeneration"].is_null());
        core.start_live_event_pump();
        assert!(Arc::strong_count(&core) > baseline);
        tokio::time::timeout(std::time::Duration::from_secs(3), core.shutdown())
            .await
            .unwrap();
        assert_eq!(Arc::strong_count(&core), baseline);
        assert!(recover_mutex(&core.live_pump_task, "LIVE pump").is_none());
        assert!(recover_mutex(&core.live_ingress_task, "LIVE ingress worker").is_none());
    }
}
