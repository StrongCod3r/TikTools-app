//! Bounded staged LIVE ingestion.
//!
//! Pipeline:
//!
//! ```text
//! TikTok WebSocket (broadcast, 512)
//!   -> pump recv loop (lightweight: stamp generation, admit)
//!   -> bounded ingress queue (2,048 ordered items, single owner)
//!   -> ordered worker (canonical processing: analytics, points, …)
//!   -> independent bounded consumers (automation slots, plugin queues, UI bus)
//! ```
//!
//! The pump never awaits processing: slow points persistence or slow
//! plugins delay the *worker*, never socket reception. The queue is
//! bounded, so sustained overload sheds predictably instead of growing
//! memory:
//!
//! - Lifecycle transitions (connect/disconnect/reconnect/error) apply
//!   backpressure (`send().await`): they are rare and must never jump the
//!   queue or vanish.
//! - Gift finalizations, follows, and shares apply bounded backpressure
//!   (1 s): they produce durable, money-grade side effects. If capacity
//!   still does not free up, the drop is counted as critical and reported
//!   as an event gap — never as successful delivery.
//! - Chat, likes, joins, intermediate gift-streak progress, room stats,
//!   and unknown payloads shed immediately (`try_send`) with explicit
//!   per-class counters. These are high-volume, low-value ticks; blocking
//!   the pump on them would trade explicit local counters for
//!   unpredictable upstream broadcast loss.
//!
//! Every admitted item is stamped with the connection generation observed
//! at ingress. The worker drops data items from an older generation once a
//! newer connection exists, so a reconnect can never credit stale events
//! to the new creator. Lifecycle items always pass: they establish the
//! generation the fence compares against.
//!
//! Honest limits: the queue bounds *count* (2,048). Individual payloads
//! are decoded TikTok structs without attachments, so worst-case retained
//! memory is ~2,048 × one decoded event (low single-digit MiB). Upstream
//! broadcast lag (network disconnects, replay limits) and downstream disk
//! failures remain explicitly reported, not absorbed: a bounded queue
//! cannot promise lossless ingestion.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use crate::*;

/// Bounded ingress capacity. 4× the upstream 512-event broadcast so a slow
/// worker has headroom before the pump must shed or exert backpressure.
pub(crate) const INGRESS_QUEUE_CAPACITY: usize = 2_048;
/// Bounded backpressure for critical data events before an explicit,
/// gap-reported drop.
const CRITICAL_SEND_TIMEOUT: Duration = Duration::from_secs(1);
/// Minimum interval between overload warnings; the counters stay exact
/// while the logs stay sparse.
const OVERLOAD_WARN_INTERVAL_MS: u64 = 1_000;

/// One admitted item: the event plus the connection generation stamped at
/// ingress for stale-generation fencing in the worker.
pub(crate) struct IngressItem {
    pub(crate) generation: u64,
    pub(crate) event: ClientEvent,
}

/// Low-overhead admission/processing counters. Atomics only; no per-event
/// logging, no high-cardinality labels.
pub(crate) struct LiveIngressStats {
    /// Items admitted into the ingress queue.
    pub(crate) accepted: AtomicU64,
    /// Items the worker finished (including fenced stale drops).
    pub(crate) processed: AtomicU64,
    /// Data events shed immediately on a full queue.
    pub(crate) dropped_data: AtomicU64,
    /// Critical events shed after the backpressure timeout.
    pub(crate) dropped_critical: AtomicU64,
    /// Upstream broadcast lag reports observed by the pump.
    pub(crate) lagged: AtomicU64,
    /// Stale-generation data items fenced by the worker.
    pub(crate) stale: AtomicU64,
    /// Approximate queued items (incremented on admit, decremented on take).
    pub(crate) queued: AtomicU64,
    /// Summed worker processing latency (ms) for mean computation.
    pub(crate) processing_latency_sum_ms: AtomicU64,
    /// Finished items behind the latency sum.
    pub(crate) processing_samples: AtomicU64,
    /// Last overload warn timestamp (millis), for rate limiting.
    last_overload_warn_at: AtomicU64,
}

impl Default for LiveIngressStats {
    fn default() -> Self {
        Self {
            accepted: AtomicU64::new(0),
            processed: AtomicU64::new(0),
            dropped_data: AtomicU64::new(0),
            dropped_critical: AtomicU64::new(0),
            lagged: AtomicU64::new(0),
            stale: AtomicU64::new(0),
            queued: AtomicU64::new(0),
            processing_latency_sum_ms: AtomicU64::new(0),
            processing_samples: AtomicU64::new(0),
            last_overload_warn_at: AtomicU64::new(0),
        }
    }
}

impl LiveIngressStats {
    pub(crate) fn diagnostics(&self) -> Value {
        let samples = self.processing_samples.load(Ordering::Relaxed);
        json!({
            "capacity": INGRESS_QUEUE_CAPACITY,
            "queued": self.queued.load(Ordering::Relaxed),
            "accepted": self.accepted.load(Ordering::Relaxed),
            "processed": self.processed.load(Ordering::Relaxed),
            "droppedData": self.dropped_data.load(Ordering::Relaxed),
            "droppedCritical": self.dropped_critical.load(Ordering::Relaxed),
            "broadcastLagged": self.lagged.load(Ordering::Relaxed),
            "staleFenced": self.stale.load(Ordering::Relaxed),
            "processingSamples": samples,
            "meanProcessingLatencyMs": if samples == 0 {
                Value::Null
            } else {
                json!(self.processing_latency_sum_ms.load(Ordering::Relaxed) as f64 / samples as f64)
            },
        })
    }

    fn note_overload(&self, message: &str) {
        let now = now_millis();
        let last = self.last_overload_warn_at.load(Ordering::Acquire);
        if last != 0 && now.saturating_sub(last) < OVERLOAD_WARN_INTERVAL_MS {
            return;
        }
        if self
            .last_overload_warn_at
            .compare_exchange(last, now, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            tracing::warn!(
                message,
                "live ingress saturated; shedding with explicit counters"
            );
        }
    }
}

/// Delivery semantics for one data event under overload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DataClass {
    /// Durable, money-grade side effects: bounded backpressure, then an
    /// explicit gap-reported drop. Never silently discarded.
    Critical,
    /// High-volume ticks: shed immediately with counters.
    Sheddable,
}

#[cfg(feature = "native-tiktok")]
pub(crate) fn classify_data_event(event: &NativeLiveEvent) -> DataClass {
    use tiktools_tiktok::events::CanonicalLiveEvent;
    match &event.base {
        CanonicalLiveEvent::Gift(gift) => {
            // Streak intermediates carry no durable change (points are
            // awarded once at finalization, and the final count covers the
            // whole streak); finals and non-streakable gifts do.
            if event.gift_streakable() && !gift.repeat_end {
                DataClass::Sheddable
            } else {
                DataClass::Critical
            }
        }
        CanonicalLiveEvent::Social(social) => {
            if social.action == 1 || social.action == 3 {
                DataClass::Critical // follow / share
            } else {
                DataClass::Sheddable
            }
        }
        // Chat, likes, joins, room stats, and unknown payloads are
        // high-volume ticks: shed with counters, never block the pump.
        _ => DataClass::Sheddable,
    }
}

/// Admits one broadcast event into the bounded ingress queue without
/// awaiting processing. Returns `false` only when the pump should stop
/// (never for shed decisions: those are counted, not propagated).
#[cfg(feature = "native-tiktok")]
pub(crate) async fn admit_event(
    core: &AppCore,
    sender: &tokio::sync::mpsc::Sender<IngressItem>,
    event: ClientEvent,
) {
    let stats = &core.live_ingress;
    match event {
        // Lifecycle transitions are rare and ordering-sensitive: wait for
        // capacity rather than drop or reorder them.
        lifecycle @ (ClientEvent::Connected(_)
        | ClientEvent::Reconnecting { .. }
        | ClientEvent::Disconnected { .. }
        | ClientEvent::Error { .. }) => {
            let generation = core.connection_sequence.load(Ordering::Acquire);
            if sender
                .send(IngressItem {
                    generation,
                    event: lifecycle,
                })
                .await
                .is_err()
            {
                tracing::debug!("live ingress worker is gone; pump stops");
            } else {
                stats.accepted.fetch_add(1, Ordering::Relaxed);
                stats.queued.fetch_add(1, Ordering::Relaxed);
            }
        }
        ClientEvent::Event(data) => {
            let generation = core.connection_sequence.load(Ordering::Acquire);
            let item = IngressItem {
                generation,
                event: ClientEvent::Event(data),
            };
            // Fast path: capacity available.
            match sender.try_send(item) {
                Ok(()) => {
                    stats.accepted.fetch_add(1, Ordering::Relaxed);
                    stats.queued.fetch_add(1, Ordering::Relaxed);
                }
                Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                    tracing::debug!("live ingress worker is gone; pump stops");
                }
                Err(tokio::sync::mpsc::error::TrySendError::Full(item)) => {
                    // Full queue: classify and shed or push back below.
                    admit_full(core, sender, item).await;
                }
            }
        }
    }
}

#[cfg(feature = "native-tiktok")]
async fn admit_full(
    core: &AppCore,
    sender: &tokio::sync::mpsc::Sender<IngressItem>,
    item: IngressItem,
) {
    let stats = &core.live_ingress;
    let critical = match &item.event {
        ClientEvent::Event(data) => classify_data_event(data) == DataClass::Critical,
        _ => false,
    };
    if !critical {
        stats.dropped_data.fetch_add(1, Ordering::Relaxed);
        stats.note_overload("shedding live data event on saturated ingress");
        return;
    }
    // Critical data: bounded backpressure, then an explicit, gap-reported
    // drop. Delivery beyond this point cannot be guaranteed, and the
    // counters say exactly that.
    match tokio::time::timeout(CRITICAL_SEND_TIMEOUT, sender.send(item)).await {
        Ok(Ok(())) => {
            stats.accepted.fetch_add(1, Ordering::Relaxed);
            stats.queued.fetch_add(1, Ordering::Relaxed);
        }
        Ok(Err(_)) => {
            tracing::debug!("live ingress worker is gone; pump stops");
        }
        Err(_) => {
            stats.dropped_critical.fetch_add(1, Ordering::Relaxed);
            core.record_event_gap();
            stats.note_overload("dropping critical live event after backpressure timeout");
            tracing::warn!(
                "critical live event shed after 1 s of ingress backpressure; gap recorded"
            );
        }
    }
}

/// Ordered worker: the sole consumer of the ingress queue. Sequential
/// processing preserves event order (points sequence, gift streaks,
/// session/creator attribution) without any parallel-handler reasoning.
/// Owned by `AppCore`, cancelled and joined at shutdown.
#[cfg(feature = "native-tiktok")]
pub(crate) async fn run_ingress_worker(
    core: Arc<AppCore>,
    mut receiver: tokio::sync::mpsc::Receiver<IngressItem>,
    shutdown: tokio_util::sync::CancellationToken,
) {
    loop {
        let item = tokio::select! {
            biased;
            () = shutdown.cancelled() => break,
            received = receiver.recv() => received,
        };
        let Some(item) = item else {
            break; // Sender dropped and queue drained: clean exit.
        };
        // Paired with the admission increment: `admit_event` is the sole
        // sender in production, so every take here matches exactly one
        // admit. Direct test injection must go through admission too.
        core.live_ingress.queued.fetch_sub(1, Ordering::Relaxed);
        // Stale-generation fence: a newer connection exists, so this data
        // item belongs to an older session and must not be credited to the
        // current creator. Lifecycle items always pass; they establish the
        // generation this fence compares against.
        if let ClientEvent::Event(_) = &item.event {
            let current = core.connection_sequence.load(Ordering::Acquire);
            if item.generation < current {
                core.live_ingress.stale.fetch_add(1, Ordering::Relaxed);
                core.live_ingress.processed.fetch_add(1, Ordering::Relaxed);
                tracing::debug!(
                    ingress_generation = item.generation,
                    current_generation = current,
                    "fenced stale live event from a superseded connection"
                );
                continue;
            }
        }
        let started = now_millis();
        core.handle_native_event(item.event).await;
        core.live_ingress.processed.fetch_add(1, Ordering::Relaxed);
        core.live_ingress
            .processing_samples
            .fetch_add(1, Ordering::Relaxed);
        core.live_ingress
            .processing_latency_sum_ms
            .fetch_add(now_millis().saturating_sub(started), Ordering::Relaxed);
    }
    // Cancellation releases every retained payload still in the queue.
    receiver.close();
    tracing::info!("live ingress worker stopped");
}

#[cfg(all(test, feature = "native-tiktok"))]
mod tests {
    use super::*;
    use tiktools_tiktok::events::{
        CanonicalLiveEvent, ChatEvent, EventMetadata, EventUser, GiftEnrichment, GiftEvent,
        LikeEvent, RoomUserEvent, SocialEvent,
    };

    struct NoopEmitter;
    impl HostEmitter for NoopEmitter {
        fn emit(&self, _: HostMessage) {}
    }

    fn user() -> EventUser {
        EventUser {
            id: 7,
            unique_id: "spectator".to_owned(),
            nickname: "Spectator".to_owned(),
            sec_uid: "sec-spectator".to_owned(),
            avatar_url: None,
        }
    }

    fn wrap(base: CanonicalLiveEvent, gift: Option<GiftEnrichment>) -> NativeLiveEvent {
        NativeLiveEvent {
            base,
            metadata: EventMetadata {
                method: "WebcastTest".to_owned(),
                msg_id: 11,
                is_history: false,
            },
            gift,
        }
    }

    fn chat() -> NativeLiveEvent {
        wrap(
            CanonicalLiveEvent::Chat(ChatEvent {
                user: user(),
                comment: "hello".to_owned(),
            }),
            None,
        )
    }

    fn gift_final() -> NativeLiveEvent {
        wrap(
            CanonicalLiveEvent::Gift(GiftEvent {
                user: user(),
                gift_id: 1,
                gift_name: "Rose".to_owned(),
                diamond_count: 1,
                repeat_count: 1,
                combo_count: 1,
                group_id: 0,
                repeat_end: true,
            }),
            Some(GiftEnrichment {
                name: "Rose".to_owned(),
                diamond_count: 1,
                streakable: true,
                icon_url: None,
            }),
        )
    }

    fn gift_streak_mid() -> NativeLiveEvent {
        wrap(
            CanonicalLiveEvent::Gift(GiftEvent {
                user: user(),
                gift_id: 1,
                gift_name: "Rose".to_owned(),
                diamond_count: 1,
                repeat_count: 3,
                combo_count: 3,
                group_id: 9,
                repeat_end: false,
            }),
            Some(GiftEnrichment {
                name: "Rose".to_owned(),
                diamond_count: 1,
                streakable: true,
                icon_url: None,
            }),
        )
    }

    fn follow() -> NativeLiveEvent {
        wrap(
            CanonicalLiveEvent::Social(SocialEvent {
                user: user(),
                action: 1,
                follow_count: 2,
                share_count: 0,
            }),
            None,
        )
    }

    fn room_stats() -> NativeLiveEvent {
        wrap(
            CanonicalLiveEvent::RoomUser(RoomUserEvent {
                total: 10,
                total_user: 12,
                popularity: 0,
                anonymous: 0,
                top_viewers: Vec::new(),
                ranked_viewers: Vec::new(),
            }),
            None,
        )
    }

    #[test]
    fn critical_events_cover_gifts_follows_and_shares() {
        assert_eq!(classify_data_event(&gift_final()), DataClass::Critical);
        assert_eq!(classify_data_event(&follow()), DataClass::Critical);
        // Streak progress, chat, likes, and room stats shed under overload.
        assert_eq!(
            classify_data_event(&gift_streak_mid()),
            DataClass::Sheddable
        );
        assert_eq!(classify_data_event(&chat()), DataClass::Sheddable);
        assert_eq!(
            classify_data_event(&wrap(
                CanonicalLiveEvent::Like(LikeEvent {
                    user: user(),
                    count: 5,
                    total: 5,
                }),
                None,
            )),
            DataClass::Sheddable
        );
        assert_eq!(classify_data_event(&room_stats()), DataClass::Sheddable);
    }

    #[tokio::test]
    async fn full_queue_sheds_data_without_blocking_admission() {
        let core = Arc::new(AppCore::new(Arc::new(NoopEmitter)));
        // Capacity 1 held by an unreceived item: every further data event
        // meets a full queue.
        let (sender, _held) = tokio::sync::mpsc::channel::<IngressItem>(1);
        sender
            .send(IngressItem {
                generation: 0,
                event: ClientEvent::Event(room_stats()),
            })
            .await
            .unwrap();
        let before = core.live_ingress.dropped_data.load(Ordering::Relaxed);
        tokio::time::timeout(
            std::time::Duration::from_secs(3),
            admit_event(&core, &sender, ClientEvent::Event(chat())),
        )
        .await
        .expect("sheddable admission never blocks");
        assert_eq!(
            core.live_ingress.dropped_data.load(Ordering::Relaxed),
            before + 1,
            "shed data must be counted, never silently lost"
        );
        // Critical data on a full queue applies bounded backpressure and,
        // when capacity cannot free up, reports a gap instead of success.
        let gaps_before = core.event_gap_stats().0;
        let critical_before = core.live_ingress.dropped_critical.load(Ordering::Relaxed);
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            admit_event(&core, &sender, ClientEvent::Event(gift_final())),
        )
        .await
        .expect("critical admission is time-bounded");
        assert_eq!(
            core.live_ingress.dropped_critical.load(Ordering::Relaxed),
            critical_before + 1
        );
        assert_eq!(core.event_gap_stats().0, gaps_before + 1);
    }

    /// Sustained overload far past queue capacity: admission stays
    /// responsive (sheddable events never block), accounting is exact
    /// (every sent item is accepted or counted shed), and memory stays
    /// bounded (the queue never exceeds its capacity).
    #[tokio::test]
    async fn sustained_overload_sheds_with_exact_accounting() {
        let core = Arc::new(AppCore::new(Arc::new(NoopEmitter)));
        let (sender, _held) = tokio::sync::mpsc::channel::<IngressItem>(INGRESS_QUEUE_CAPACITY);
        // Occupy the queue the same way a stalled worker would: the held
        // receiver never drains, so every further admit meets pressure.
        for _ in 0..INGRESS_QUEUE_CAPACITY {
            sender
                .send(IngressItem {
                    generation: 0,
                    event: ClientEvent::Event(room_stats()),
                })
                .await
                .unwrap();
        }
        let sent = 10_000;
        let started = now_millis();
        for id in 0..sent {
            let event = if id % 2 == 0 { chat() } else { room_stats() };
            tokio::time::timeout(
                std::time::Duration::from_secs(5),
                admit_event(&core, &sender, ClientEvent::Event(event)),
            )
            .await
            .expect("sheddable admission never blocks");
        }
        let elapsed = now_millis().saturating_sub(started);
        let accepted = core.live_ingress.accepted.load(Ordering::Relaxed);
        let dropped = core.live_ingress.dropped_data.load(Ordering::Relaxed);
        // The prefill injected pressure directly (never drained, never
        // counted); every item sent through admission is either admitted
        // or counted shed — none vanish.
        assert_eq!(
            accepted + dropped,
            sent as u64,
            "every admitted item is accepted or counted shed"
        );
        assert_eq!(accepted, 0, "a saturated queue admits nothing further");
        assert!(
            core.live_ingress.queued.load(Ordering::Relaxed) <= INGRESS_QUEUE_CAPACITY as u64,
            "the queue never exceeds its bound"
        );
        println!(
            "  sustained overload: {sent} shed-path admits in {elapsed} ms, dropped={dropped}"
        );
    }

    /// Shutdown while the queue is saturated: the worker drains every
    /// accepted item (stale ones fence fast) and joins — no retained
    /// payloads, no detached task.
    #[tokio::test]
    async fn saturated_queue_drains_and_joins_on_shutdown() {
        let core = Arc::new(AppCore::new(Arc::new(NoopEmitter)));
        let (sender, receiver) = tokio::sync::mpsc::channel::<IngressItem>(64);
        // Admit through the real path (the sole production sender), so the
        // queue gauge pairs exactly with worker takes. Stamps read
        // generation 0 here ...
        for _ in 0..64 {
            admit_event(&core, &sender, ClientEvent::Event(chat())).await;
        }
        // ... and a newer connection arrives before the drain: every item
        // fences on the fast path, so the drain is quick and side-effect
        // free.
        core.connection_sequence.store(9, Ordering::Release);
        assert_eq!(core.live_ingress.queued.load(Ordering::Relaxed), 64);
        drop(sender);
        let shutdown = tokio_util::sync::CancellationToken::new();
        tokio::time::timeout(
            std::time::Duration::from_secs(10),
            run_ingress_worker(Arc::clone(&core), receiver, shutdown),
        )
        .await
        .expect("saturated worker drains and exits");
        assert_eq!(core.live_ingress.stale.load(Ordering::Relaxed), 64);
        assert_eq!(core.live_ingress.processed.load(Ordering::Relaxed), 64);
        assert_eq!(core.live_ingress.queued.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn worker_fences_stale_generations_and_joins() {
        let core = Arc::new(AppCore::new(Arc::new(NoopEmitter)));
        // A newer connection exists: the queued item belongs to the old one.
        core.connection_sequence.store(4, Ordering::Release);
        let (sender, receiver) = tokio::sync::mpsc::channel::<IngressItem>(8);
        sender
            .send(IngressItem {
                generation: 2,
                event: ClientEvent::Event(chat()),
            })
            .await
            .unwrap();
        let shutdown = tokio_util::sync::CancellationToken::new();
        let worker = tokio::spawn(run_ingress_worker(
            Arc::clone(&core),
            receiver,
            shutdown.clone(),
        ));
        // Let the worker take the item, then stop it cleanly.
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        shutdown.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(3), worker)
            .await
            .expect("worker joins")
            .expect("worker task succeeds");
        assert_eq!(core.live_ingress.stale.load(Ordering::Relaxed), 1);
        assert_eq!(core.live_ingress.processed.load(Ordering::Relaxed), 1);
        // The fenced chat never reached points: no side effects, no viewer.
        assert!(core.points.viewer("spectator").is_none());
        let diagnostics = core.live_ingress.diagnostics();
        assert_eq!(diagnostics["capacity"], INGRESS_QUEUE_CAPACITY);
        assert_eq!(diagnostics["staleFenced"], 1);
    }
}
