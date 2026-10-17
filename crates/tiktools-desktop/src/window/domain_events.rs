//! Main-page projection before serialization. Other bus consumers are independent.
use super::projection::MainPageProjection;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tiktools_core::{events::DomainEvent, AppCore};

fn projected(
    topic: &str,
    view: super::projection::PageView,
    data: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({"jsonrpc": "2.0", "method": "event", "params": {
        "topic": topic, "data": data, "generation": view.generation, "revision": view.revision,
    }})
}

/// A single owned timer provides trailing snapshots even when traffic stops.
/// No per-viewer retention: the points service already owns authoritative
/// absolute totals and bounded top-K selection. A dirty bit costs constant
/// space for a burst of any number of viewers. The stream keeps individual
/// points/run events on the control bus, but the main page gets projections.
/// Reliable gaps still force explicit authoritative resync.
pub(crate) async fn forward_domain_events(
    mut events: tiktools_core::events::DomainSubscription,
    core: Arc<AppCore>,
    projection: Arc<MainPageProjection>,
    mut send: impl FnMut(&serde_json::Value, u64),
) {
    use tiktools_core::events::DomainRecvError;
    let cadence = std::time::Duration::from_millis(250);
    let mut clock = tokio::time::interval_at(tokio::time::Instant::now() + cadence, cadence);
    clock.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_feed_sequence = events.ui_sequence();
    let mut points_dirty = false;
    let mut runs_dirty = false;
    let mut last_view = (u64::MAX, u64::MAX, false);
    let mut stats_at = tokio::time::Instant::now();
    loop {
        tokio::select! {
            _ = clock.tick() => {
                let view = projection.view();
                let identity = (view.generation, view.revision, view.visible);
                if identity != last_view {
                    // Re-open/reload resync reads authoritative state, never
                    // replays a hidden-tab backlog. Also covers host visibility.
                    points_dirty = true;
                    runs_dirty = true;
                    last_view = identity;
                }
                if view.visible && view.points && points_dirty {
                    send(&projected("ui.points.snapshot", view, serde_json::json!({
                        "viewers": core.points_leaderboard(Some(100)),
                    })), view.generation);
                    points_dirty = false;
                    projection.snapshots.fetch_add(1, Ordering::Relaxed);
                }
                if view.visible && view.behavior && runs_dirty {
                    send(&projected("ui.automation.runs", view, serde_json::json!({
                        "runs": core.automation_runs(),
                    })), view.generation);
                    runs_dirty = false;
                    projection.snapshots.fetch_add(1, Ordering::Relaxed);
                }
                if view.revision > 0 && (view.visible || stats_at.elapsed().as_secs() >= 1) {
                    send(&projected("ui.projection.stats", view, projection.diagnostics()), view.generation);
                    stats_at = tokio::time::Instant::now();
                }
            }
            received = events.recv_shared() => {
                let view = projection.view();
                let event = match received {
                    Ok(event) => event,
                    Err(DomainRecvError::ReliableLagged(lost)) => {
                        core.record_event_gap();
                        points_dirty = true;
                        runs_dirty = true;
                        send(&tiktools_control_api::gap_notification(lost), view.generation);
                        continue;
                    }
                    Err(DomainRecvError::LossyLagged(skipped)) => {
                        projection.lossy_skipped.fetch_add(skipped, Ordering::Relaxed);
                        continue;
                    }
                    Err(DomainRecvError::Closed) => break,
                };
                projection.source.fetch_add(1, Ordering::Relaxed);
                let mut feed_cursor = None;
                if matches!(event.as_ref(), DomainEvent::LiveUiEvent { .. }) {
                    let sequence = events.ui_sequence();
                    projection.feed_bus_dropped.fetch_add(sequence.saturating_sub(last_feed_sequence).saturating_sub(1), Ordering::Relaxed);
                    last_feed_sequence = sequence;
                    // Journal before the visibility filter so hidden and
                    // reconnected pages can backfill every retained event.
                    projection.record_feed(sequence, Arc::clone(&event));
                    feed_cursor = Some(sequence);
                }
                match event.as_ref() {
                    DomainEvent::LiveEvent { .. } | DomainEvent::AnalyticsUpdated { .. } => {
                        projection.filtered.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    DomainEvent::LiveUiEvent { .. } if !view.visible || !view.feed => {
                        projection.feed_suspended.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    DomainEvent::PointsReset { .. } => { points_dirty = true; }
                    DomainEvent::PointsChanged { .. } => {
                        points_dirty = true;
                        projection.points_coalesced.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    DomainEvent::AutomationRunCompleted { .. } => {
                        runs_dirty = true;
                        projection.runs_coalesced.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    DomainEvent::AutomationRunsChanged { .. } => { runs_dirty = true; continue; }
                    _ => {}
                }
                let shutdown = matches!(event.as_ref(), DomainEvent::Shutdown);
                // Feed messages are revision fenced as well as generation
                // fenced; late in-flight messages cannot commit on a hidden tab.
                if matches!(event.as_ref(), DomainEvent::LiveUiEvent { .. }) {
                    if let Ok(envelope) = event.to_envelope() {
                        let mut data = envelope.data;
                        data["cursor"] = serde_json::json!(feed_cursor.unwrap_or(0));
                        data["sequence"] = serde_json::json!(projection.feed_forwarded.fetch_add(1, Ordering::Relaxed) + 1);
                        send(&projected("live.ui-event", view, data), view.generation);
                    }
                } else {
                    let mut notification = tiktools_control_api::event_notification(event.as_ref());
                    notification["params"]["generation"] = serde_json::json!(view.generation);
                    send(&notification, view.generation);
                }
                if shutdown { break; }
            }
        }
    }
}
