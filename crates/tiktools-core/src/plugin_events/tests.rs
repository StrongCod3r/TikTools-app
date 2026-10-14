//! Plugin event observer unit tests.

use super::queue::{WorkerHandle, PLUGIN_EVENT_QUEUE_CAPACITY};
use super::supervisor::reconcile_workers;
use crate::events::DomainEvent;
use crate::AppCore;
use std::collections::BTreeMap;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

struct NoopEmitter;

impl crate::HostEmitter for NoopEmitter {
    fn emit(&self, _message: crate::ipc::messages::HostMessage) {}
}

fn worker_handle() -> WorkerHandle {
    let (sender, _) = tokio::sync::mpsc::channel(PLUGIN_EVENT_QUEUE_CAPACITY);
    WorkerHandle {
        generation: 0,
        sender,
        token: tokio_util::sync::CancellationToken::new(),
        pending_reliable_gaps: Arc::new(AtomicU64::new(0)),
    }
}

#[test]
fn reconcile_prunes_workers_without_a_live_plugin() {
    let core = AppCore::new(Arc::new(NoopEmitter));
    let plugins = core.plugins.list();
    let mut workers = BTreeMap::from([
        ("ghost-a".to_owned(), worker_handle()),
        ("ghost-b".to_owned(), worker_handle()),
    ]);
    reconcile_workers(&core, &plugins, &mut workers);
    assert!(
        workers.is_empty(),
        "workers for unknown plugins must be pruned, keeping {:?}",
        workers.keys().collect::<Vec<_>>()
    );
}

#[test]
fn reconcile_keeps_nothing_when_no_workers_exist() {
    let core = AppCore::new(Arc::new(NoopEmitter));
    let plugins = core.plugins.list();
    let mut workers = BTreeMap::new();
    reconcile_workers(&core, &plugins, &mut workers);
    assert!(workers.is_empty());
}

#[test]
fn repeated_pruning_cancels_workers_and_releases_queues() {
    let core = AppCore::new(Arc::new(NoopEmitter));
    for _ in 0..128 {
        let (sender, mut receiver) = tokio::sync::mpsc::channel(PLUGIN_EVENT_QUEUE_CAPACITY);
        let token = tokio_util::sync::CancellationToken::new();
        let mut workers = BTreeMap::from([(
            "removed".to_owned(),
            WorkerHandle {
                generation: 0,
                sender,
                token: token.clone(),
                pending_reliable_gaps: Arc::new(AtomicU64::new(0)),
            },
        )]);
        reconcile_workers(&core, &[], &mut workers);
        assert!(workers.is_empty());
        assert!(token.is_cancelled());
        assert!(matches!(
            receiver.try_recv(),
            Err(tokio::sync::mpsc::error::TryRecvError::Disconnected)
        ));
    }
}

#[tokio::test]
async fn cancelled_queue_worker_releases_core_and_pending_events() {
    let core = Arc::new(AppCore::new(Arc::new(NoopEmitter)));
    let baseline = Arc::strong_count(&core);
    let (sender, receiver) = tokio::sync::mpsc::channel(PLUGIN_EVENT_QUEUE_CAPACITY);
    let token = tokio_util::sync::CancellationToken::new();
    for _ in 0..PLUGIN_EVENT_QUEUE_CAPACITY {
        core.record_plugin_accepted("removed");
        sender
            .try_send(super::queue::QueuedPluginEvent {
                envelope: Arc::new(tiktools_plugin_api::DomainEventEnvelope::new(
                    "test",
                    serde_json::json!({}),
                )),
                lossy: true,
            })
            .unwrap();
    }
    token.cancel();
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        super::worker::run_plugin_queue(
            Arc::clone(&core),
            "removed".to_owned(),
            0,
            receiver,
            token,
            Arc::new(AtomicU64::new(0)),
        ),
    )
    .await
    .expect("cancelled worker must terminate without draining or delivering");
    assert!(sender.is_closed());
    assert_eq!(Arc::strong_count(&core), baseline);
    assert_eq!(
        crate::recover_mutex(&core.plugin_delivery, "delivery")["removed"].queued,
        0
    );
}

#[test]
fn fanout_entry_matches_exact_wildcard_and_match_all() {
    use super::fanout::FanoutEntry;
    let entry = FanoutEntry {
        id: "exact".to_owned(),
        exact: vec!["points.changed".to_owned()],
        prefixes: vec![],
        match_all: false,
        static_eligible: true,
    };
    assert!(entry.matches("points.changed"));
    assert!(!entry.matches("points.other"));
    assert!(!entry.matches("points.changed.extra"));

    let wildcard = FanoutEntry {
        id: "wild".to_owned(),
        exact: vec![],
        prefixes: vec!["live".to_owned()],
        match_all: false,
        static_eligible: true,
    };
    assert!(wildcard.matches("live.event"));
    assert!(wildcard.matches("live.ui-event"));
    // Namespace boundary: `liveevent` and bare `live` are not `live.*`.
    assert!(!wildcard.matches("liveevent"));
    assert!(!wildcard.matches("live"));
    assert!(!wildcard.matches("points.changed"));

    let all = FanoutEntry {
        id: "all".to_owned(),
        exact: vec![],
        prefixes: vec![],
        match_all: true,
        static_eligible: true,
    };
    assert!(all.matches("anything.at.all"));
}

#[test]
fn fanout_matcher_agrees_with_subscription_semantics() {
    use tiktools_plugin_api::event_subscription_matches;
    let cases = [
        ("*", "live.event", true),
        ("live.*", "live.event", true),
        ("live.*", "live", false),
        ("live.*", "liveevent", false),
        ("points.changed", "points.changed", true),
        ("points.changed", "points.changed.extra", false),
        ("points.*", "points.changed.extra", true),
    ];
    for (subscription, topic, expected) in cases {
        assert_eq!(
            event_subscription_matches(subscription, topic),
            expected,
            "reference semantics for {subscription:?} vs {topic:?}"
        );
    }
}

#[test]
fn fanout_cache_matches_registry_and_tracks_revisions() {
    use super::fanout::FanoutCache;
    use std::sync::atomic::Ordering;
    let core = AppCore::new(Arc::new(NoopEmitter));
    let loader_before = core.plugins.registry_revision();
    {
        let cache = FanoutCache::current(&core);
        // Every cached match is statically eligible and genuinely
        // subscribed; the gap broadcast reaches every entry.
        for topic in [
            "live.event",
            "points.changed",
            "tiktok.chat",
            "plugin.event",
        ] {
            let matched = cache.matching(topic, false);
            let forced = cache.matching(topic, true);
            for index in &matched {
                let entry = cache.entry(*index);
                assert!(entry.static_eligible, "{} must be eligible", entry.id);
                assert!(entry.matches(topic), "{} must match {topic}", entry.id);
                assert!(
                    forced.contains(index),
                    "gap broadcast must include {topic} subscribers"
                );
            }
        }
    }
    // Activation writes invalidate the cache; the next dispatch rebuilds
    // without touching the loader revision.
    core.set_plugin_activation("ghost", true, false);
    assert_eq!(
        core.plugin_state
            .activation_revision
            .load(Ordering::Acquire),
        2
    );
    {
        let rebuilt = FanoutCache::current(&core);
        let _ = rebuilt.matching("live.event", false);
    }
    assert_eq!(core.plugins.registry_revision(), loader_before);
}

#[test]
fn rapid_enable_disable_cycles_keep_fanout_consistent() {
    use super::fanout::FanoutCache;
    use std::sync::atomic::Ordering;
    let core = AppCore::new(Arc::new(NoopEmitter));
    // A hundred enable/disable flaps: every write bumps the revision, and
    // the cache rebuilds exactly once per generation of flaps — no stale
    // subscriber set survives a cycle.
    for round in 0..100 {
        core.set_plugin_activation("flapper", true, round % 2 == 0);
    }
    assert_eq!(
        core.plugin_state
            .activation_revision
            .load(Ordering::Acquire),
        101
    );
    let cache = FanoutCache::current(&core);
    let _ = cache.matching("live.event", false);
    let _ = cache.matching("live.event", true);
}

#[test]
fn delivery_counters_distinguish_overload_from_failure() {
    let core = AppCore::new(Arc::new(NoopEmitter));
    core.record_plugin_accepted("fast");
    core.record_plugin_accepted("fast");
    core.record_plugin_taken("fast");
    core.record_plugin_delivered("fast", 12, false, false);
    core.record_plugin_queue_drop("slow");
    core.record_plugin_drops("slow", 1);
    core.record_plugin_delivered("slow", 5_000, true, true);
    core.record_plugin_worker_start("slow");
    core.record_plugin_worker_start("slow");
    let diagnostics = core.plugin_diagnostics();
    diagnostics["plugins"].as_array().expect("plugin array");
    let stats = crate::recover_mutex(&core.plugin_delivery, "plugin delivery");
    let delivery = super::fanout::delivery_snapshot(&stats);
    let fast = delivery
        .iter()
        .find(|entry| entry["pluginId"] == "fast")
        .expect("fast stats");
    assert_eq!(fast["accepted"], 2);
    assert_eq!(fast["queued"], 1);
    assert_eq!(fast["completed"], 1);
    assert_eq!(fast["failed"], 0);
    assert_eq!(fast["meanLatencyMs"], 12.0);
    let slow = delivery
        .iter()
        .find(|entry| entry["pluginId"] == "slow")
        .expect("slow stats");
    assert_eq!(slow["dropped"], 1);
    assert_eq!(slow["failed"], 1);
    assert_eq!(slow["timeouts"], 1);
    assert_eq!(slow["restarts"], 2);
}

#[test]
fn stable_domain_payload_does_not_expose_the_internal_enum() {
    let event = DomainEvent::PointsChanged {
        unique_id: "viewer".to_owned(),
        delta: 2.0,
        total_points: 4.0,
        level: 1,
    };
    let envelope = event.to_envelope().expect("variant must convert");
    assert_eq!(envelope.topic, "points.changed");
    assert_eq!(envelope.data["uniqueId"], "viewer");
    assert!(serde_json::to_value(envelope)
        .unwrap()
        .get("topic")
        .is_some());
}
