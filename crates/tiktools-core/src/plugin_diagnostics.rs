//! In-memory plugin runtime diagnostics: last received event per plugin,
//! host-side poll drop counters, and hotkey binding synchronization state.
//!
//! Everything here is process-local and minimal: timestamps, counters, and
//! the small hotkey chord projection. No keyboard history is persisted and
//! no key contents are logged.

use super::*;

/// Last validated event received from one plugin. The `detail` projection
/// carries only the small hotkey chord fields (`key`, `modifiers`,
/// `backend`, `sequence`) when present as short strings; anything else is
/// omitted so arbitrary plugin payloads never accumulate here.
#[derive(Debug, Clone, Default)]
pub(crate) struct PluginLastEvent {
    pub(crate) event_type: String,
    pub(crate) at: u64,
    pub(crate) detail: BTreeMap<String, String>,
}

/// Host-side hotkey binding synchronization state. `desired_revision` is the
/// persisted Behavior projection revision, `applied_revision` the revision
/// last confirmed by the plugin process; equality plus `last_error == None`
/// means the plugin runs the current bindings.
#[derive(Debug, Clone, Default)]
pub(crate) struct HotkeySyncState {
    pub(crate) last_config: Option<Value>,
    pub(crate) last_error: Option<String>,
    pub(crate) last_sync_at: Option<u64>,
}

impl AppCore {
    /// Records one validated plugin event for diagnostics. Called on the
    /// control-plane path (before automation), so the record exists even
    /// when automation has no match, fails, or is saturated.
    pub(crate) fn record_plugin_event(&self, plugin_id: &str, event: &Value) {
        let event_type = event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let mut detail = BTreeMap::new();
        if let Some(data) = event.get("data").and_then(Value::as_object) {
            for key in ["key", "modifiers", "backend", "sequence"] {
                if let Some(value) = data.get(key).and_then(Value::as_str) {
                    if !value.is_empty() && value.len() <= 64 {
                        detail.insert(key.to_owned(), value.to_owned());
                    }
                }
            }
        }
        recover_mutex(&self.plugin_last_events, "plugin last-event").insert(
            plugin_id.to_owned(),
            PluginLastEvent {
                event_type,
                at: now_millis(),
                detail,
            },
        );
    }

    /// Adds host-side plugin event drops for one plugin. Every drop is also
    /// logged at the call site with its reason; the counter makes totals
    /// visible through diagnostics and health RPCs.
    pub(crate) fn record_plugin_drops(&self, plugin_id: &str, dropped: u64) {
        if dropped == 0 {
            return;
        }
        *recover_mutex(&self.plugin_event_drops, "plugin drops")
            .entry(plugin_id.to_owned())
            .or_default() += dropped;
    }

    pub(crate) fn plugin_drop_total(&self) -> u64 {
        recover_mutex(&self.plugin_event_drops, "plugin drops")
            .values()
            .sum()
    }

    /// Records one accepted queue admission for per-plugin throughput
    /// accounting. The worker decrements the queued gauge on take.
    pub(crate) fn record_plugin_accepted(&self, plugin_id: &str) {
        let mut stats = recover_mutex(&self.plugin_delivery, "plugin delivery");
        let entry = stats.entry(plugin_id.to_owned()).or_default();
        entry.accepted = entry.accepted.saturating_add(1);
        entry.queued = entry.queued.saturating_add(1);
    }

    /// Records one shed queue admission (full queue).
    pub(crate) fn record_plugin_queue_drop(&self, plugin_id: &str) {
        let mut stats = recover_mutex(&self.plugin_delivery, "plugin delivery");
        let entry = stats.entry(plugin_id.to_owned()).or_default();
        entry.dropped = entry.dropped.saturating_add(1);
    }

    /// Releases one queued item once the worker takes it (before delivery).
    pub(crate) fn record_plugin_taken(&self, plugin_id: &str) {
        let mut stats = recover_mutex(&self.plugin_delivery, "plugin delivery");
        let entry = stats.entry(plugin_id.to_owned()).or_default();
        entry.queued = entry.queued.saturating_sub(1);
    }

    /// Records one finished delivery with its latency. Timeouts count both
    /// as failures and as timeouts so overload is distinguishable from
    /// ordinary plugin errors.
    pub(crate) fn record_plugin_delivered(
        &self,
        plugin_id: &str,
        latency_ms: u64,
        failed: bool,
        timed_out: bool,
    ) {
        let mut stats = recover_mutex(&self.plugin_delivery, "plugin delivery");
        let entry = stats.entry(plugin_id.to_owned()).or_default();
        if failed {
            entry.failed = entry.failed.saturating_add(1);
        } else {
            entry.completed = entry.completed.saturating_add(1);
        }
        if timed_out {
            entry.timeouts = entry.timeouts.saturating_add(1);
        }
        entry.latency_sum_ms = entry.latency_sum_ms.saturating_add(latency_ms);
        entry.latency_samples = entry.latency_samples.saturating_add(1);
    }

    /// Records one worker (re)start for restart accounting.
    pub(crate) fn record_plugin_worker_start(&self, plugin_id: &str) {
        let mut stats = recover_mutex(&self.plugin_delivery, "plugin delivery");
        let entry = stats.entry(plugin_id.to_owned()).or_default();
        entry.restarts = entry.restarts.saturating_add(1);
    }

    /// Read-only diagnostics snapshot for the `plugins.diagnostics` RPC:
    /// per-plugin last event, host-side drops, delivery throughput, and
    /// hotkey sync state.
    pub fn plugin_diagnostics(&self) -> Value {
        let last_events = recover_mutex(&self.plugin_last_events, "plugin last-event").clone();
        let drops = recover_mutex(&self.plugin_event_drops, "plugin drops").clone();
        let delivery = crate::plugin_events::fanout::delivery_snapshot(&recover_mutex(
            &self.plugin_delivery,
            "plugin delivery",
        ));
        let sync = recover_mutex(&self.hotkey_sync_state, "hotkey sync").clone();
        let desired = self.hotkey_sync_revision.load(Ordering::Acquire);
        let applied = self.hotkey_synced_revision.load(Ordering::Acquire);
        let mut plugins: Vec<Value> = self
            .plugins
            .list()
            .into_iter()
            .map(|plugin| {
                let id = plugin.manifest.id.clone();
                let last = last_events.get(&id);
                let throughput = delivery
                    .iter()
                    .find(|entry| {
                        entry.get("pluginId").and_then(Value::as_str) == Some(id.as_str())
                    })
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                json!({
                    "pluginId": id,
                    "running": plugin.running,
                    "available": plugin.available,
                    "lastEventAt": last.map(|event| event.at),
                    "lastEventType": last.map(|event| event.event_type.clone()),
                    "lastEvent": last.map(|event| event.detail.clone()),
                    "droppedEvents": drops.get(&id).copied().unwrap_or(0),
                    "delivery": throughput,
                })
            })
            .collect();
        plugins.sort_by(|left, right| {
            left.get("pluginId")
                .and_then(Value::as_str)
                .cmp(&right.get("pluginId").and_then(Value::as_str))
        });
        json!({
            "plugins": plugins,
            "hotkeySync": {
                "desiredRevision": desired,
                "appliedRevision": applied,
                "inSync": desired == applied && sync.last_error.is_none(),
                "lastSyncAt": sync.last_sync_at,
                "lastError": sync.last_error,
                "appliedConfig": sync.last_config,
            },
        })
    }
}
