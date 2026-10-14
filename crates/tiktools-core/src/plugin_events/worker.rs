//! One ordered delivery worker per subscribed plugin.

use super::delivery::deliver_event;
use super::queue::QueuedPluginEvent;
use crate::{now_millis, AppCore};
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tiktools_plugin_api::DomainEventEnvelope;
use tokio::sync::mpsc;

pub(crate) async fn run_plugin_queue(
    core: Arc<AppCore>,
    plugin_id: String,
    generation: u64,
    mut receiver: mpsc::Receiver<QueuedPluginEvent>,
    shutdown: tokio_util::sync::CancellationToken,
    pending_reliable_gaps: Arc<AtomicU64>,
) {
    let invoker = crate::plugin_invoker::PluginInvoker::new(Arc::clone(&core.plugins));
    loop {
        let queued = tokio::select! {
            biased;
            () = shutdown.cancelled() => break,
            queued = receiver.recv() => match queued {
                Some(queued) => queued,
                None => break,
            },
        };

        // The item left the queue: release the gauge before delivery so
        // queue depth reflects genuinely pending work, not in-flight calls.
        core.record_plugin_taken(&plugin_id);
        // Drop everything queued while the plugin was disabled/stopped. The
        // lifecycle operation owns the authoritative state; event delivery
        // must never restart a plugin as a side effect.
        if !core.plugin_ready(&plugin_id) || !core.plugins.is_running(&plugin_id) {
            continue;
        }

        let lost = pending_reliable_gaps.swap(0, Ordering::AcqRel);
        if lost > 0 {
            let gap = DomainEventEnvelope::new(
                "event.gap",
                json!({"lost": lost, "resync": true, "at": now_millis()}),
            );
            // Let the loader deadline retire failed process generations.
            // Dropping this future on cancellation skips that cleanup path.
            let delivered =
                deliver_event(&core, &invoker, &plugin_id, generation, &gap, false).await;
            if !delivered {
                // Keep the summary if a transient delivery failure happened
                // while the plugin remained active; a stopped/crashed plugin
                // will simply drain it when it is explicitly restarted.
                pending_reliable_gaps.fetch_add(lost, Ordering::Relaxed);
            }
        }
        if shutdown.is_cancelled() {
            break;
        }
        // In-flight delivery remains bounded by the loader deadline. Awaiting
        // it preserves process timeout cleanup before supervisor teardown.
        let _ = deliver_event(
            &core,
            &invoker,
            &plugin_id,
            generation,
            &queued.envelope,
            queued.lossy,
        )
        .await;
    }
    receiver.close();
    while receiver.try_recv().is_ok() {
        core.record_plugin_taken(&plugin_id);
    }
}
