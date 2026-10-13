//! Precomputed event-subscription fan-out.
//!
//! The observer's hot path used to clone the whole plugin registry, check
//! readiness and capabilities, and scan subscription patterns for every
//! plugin on every event — O(plugins × subscriptions) deep clones per
//! event. This cache reduces that to one revision check plus a topic-index
//! lookup:
//!
//! - Exact topics map to their subscriber sets; namespace wildcards
//!   (`live.*`) map to prefix buckets; `*` maps to a match-all set.
//! - Each entry carries the slow-changing delivery facts (running,
//!   available, non-declarative runtime, `events.subscribe` declared,
//!   non-empty subscriptions). Fast-changing facts — the running
//!   generation (fencing) and activation readiness — are still read live
//!   per matched plugin, so races between lifecycle changes and dispatch
//!   resolve correctly.
//! - The cache rebuilds (one registry clone) only when the loader's
//!   registry revision or the activation revision moves: install,
//!   uninstall, start, stop, generation retirement, enable, disable.
//!   Steady-state events never clone the registry.
//!
//! Worker/queue ownership, per-plugin ordering, the 64-event bounded
//! queues, and the reliable-gap protocol are unchanged.

use std::collections::{BTreeMap, HashMap};

use tiktools_plugin_api::capabilities::{declares_capability, EVENTS_SUBSCRIBE};
use tiktools_plugin_api::PluginRuntimeKind;

use crate::AppCore;

/// One plugin's cached fan-out facts.
#[derive(Debug, Clone)]
pub(crate) struct FanoutEntry {
    pub(crate) id: String,
    /// Exact topics this plugin subscribes to.
    pub(crate) exact: Vec<String>,
    /// Namespace prefixes from `prefix.*` subscriptions (without the `.*`).
    pub(crate) prefixes: Vec<String>,
    /// True for a bare `*` subscription.
    pub(crate) match_all: bool,
    /// Slow-changing delivery eligibility: running, available,
    /// non-declarative, declares `events.subscribe`, has subscriptions.
    /// Activation readiness and the running generation stay live reads.
    pub(crate) static_eligible: bool,
}

impl FanoutEntry {
    pub(crate) fn matches(&self, topic: &str) -> bool {
        if self.match_all || self.exact.iter().any(|exact| exact == topic) {
            return true;
        }
        self.prefixes.iter().any(|prefix| {
            topic
                .strip_prefix(prefix.as_str())
                .is_some_and(|remainder| remainder.starts_with('.'))
        })
    }
}

/// Cached fan-out table plus the revisions it was built from.
#[derive(Debug, Default)]
pub(crate) struct FanoutCache {
    loader_revision: u64,
    activation_revision: u64,
    entries: Vec<FanoutEntry>,
    /// Exact-topic index into `entries` for O(1) fan-out.
    exact_index: HashMap<String, Vec<usize>>,
    /// Plugin IDs with a bare `*` subscription.
    match_all: Vec<usize>,
    /// Plugin IDs with at least one namespace wildcard.
    wildcard: Vec<usize>,
}

impl FanoutCache {
    /// Returns the cache when both revisions still hold, rebuilding (one
    /// registry clone) otherwise. The returned guard borrows the cache
    /// mutex; matching itself performs no further locking.
    pub(crate) fn current(core: &AppCore) -> std::sync::MutexGuard<'_, FanoutCache> {
        let loader_revision = core.plugins.registry_revision();
        let activation_revision = core
            .plugin_state
            .activation_revision
            .load(std::sync::atomic::Ordering::Acquire);
        let mut cache = crate::recover_mutex(&core.plugin_state.fanout, "plugin fanout cache");
        if cache.loader_revision != loader_revision
            || cache.activation_revision != activation_revision
        {
            *cache = rebuild(core, loader_revision, activation_revision);
        }
        cache
    }

    /// Subscriber entry behind a matched index.
    pub(crate) fn entry(&self, index: usize) -> &FanoutEntry {
        &self.entries[index]
    }

    /// Indices of statically eligible entries whose subscriptions match
    /// `topic`, or every statically eligible entry when
    /// `force_all_subscribers` (event-gap broadcast) is set. Eligibility
    /// is enforced here, so dispatch never fans out to a plugin that
    /// cannot receive events.
    pub(crate) fn matching(&self, topic: &str, force_all_subscribers: bool) -> Vec<usize> {
        let eligible = |index: usize| self.entries[index].static_eligible;
        if force_all_subscribers {
            return (0..self.entries.len())
                .filter(|index| eligible(*index))
                .collect();
        }
        let mut matched: Vec<usize> = self
            .exact_index
            .get(topic)
            .map(|indices| {
                indices
                    .iter()
                    .copied()
                    .filter(|index| eligible(*index))
                    .collect()
            })
            .unwrap_or_default();
        matched.extend(
            self.match_all
                .iter()
                .copied()
                .filter(|index| eligible(*index)),
        );
        for index in &self.wildcard {
            if matched.contains(index) {
                continue;
            }
            if eligible(*index) && self.entries[*index].matches(topic) {
                matched.push(*index);
            }
        }
        matched
    }
}

fn rebuild(core: &AppCore, loader_revision: u64, activation_revision: u64) -> FanoutCache {
    let mut cache = FanoutCache {
        loader_revision,
        activation_revision,
        entries: Vec::new(),
        exact_index: HashMap::new(),
        match_all: Vec::new(),
        wildcard: Vec::new(),
    };
    for plugin in core.plugins.list() {
        let id = plugin.manifest.id.clone();
        let mut entry = FanoutEntry {
            id,
            exact: Vec::new(),
            prefixes: Vec::new(),
            match_all: false,
            static_eligible: false,
        };
        for subscription in &plugin.manifest.event_subscriptions {
            if subscription == "*" {
                entry.match_all = true;
            } else if let Some(prefix) = subscription.strip_suffix(".*") {
                if !prefix.is_empty() {
                    entry.prefixes.push(prefix.to_owned());
                }
            } else {
                entry.exact.push(subscription.clone());
            }
        }
        // Mirror `eligible_for_delivery` minus the live activation read:
        // running, available, non-declarative, declares the capability
        // (the same pure manifest helper the hot path used), and actually
        // subscribes to something. Anything failing here can never receive
        // events until the next lifecycle change rebuilds.
        entry.static_eligible = plugin.running
            && plugin.available
            && plugin.manifest.runtime != PluginRuntimeKind::Declarative
            && declares_capability(&plugin.manifest, EVENTS_SUBSCRIBE)
            && !plugin.manifest.event_subscriptions.is_empty();
        let index = cache.entries.len();
        for topic in &entry.exact {
            cache
                .exact_index
                .entry(topic.clone())
                .or_default()
                .push(index);
        }
        if entry.match_all {
            cache.match_all.push(index);
        }
        if !entry.prefixes.is_empty() {
            cache.wildcard.push(index);
        }
        cache.entries.push(entry);
    }
    cache
}

/// Per-plugin delivery counters. No payloads, no topics with cardinality —
/// only plugin IDs, which are bounded by the installed set.
#[derive(Debug, Clone, Default)]
pub(crate) struct PluginDeliveryStats {
    /// Events accepted into the worker queue.
    pub(crate) accepted: u64,
    /// Events shed at a full queue.
    pub(crate) dropped: u64,
    /// Deliveries completed without error.
    pub(crate) completed: u64,
    /// Deliveries that failed (including timeouts).
    pub(crate) failed: u64,
    /// Deliveries that hit the loader deadline.
    pub(crate) timeouts: u64,
    /// Worker (re)starts for this plugin.
    pub(crate) restarts: u64,
    /// Sum of delivery latencies (ms) for mean computation.
    pub(crate) latency_sum_ms: u64,
    /// Samples behind `latency_sum_ms`.
    pub(crate) latency_samples: u64,
    /// Approximate queued events (accepted − taken by the worker).
    pub(crate) queued: i64,
}

/// Per-plugin IDs in stable order for diagnostics snapshots.
pub(crate) fn delivery_snapshot(
    stats: &BTreeMap<String, PluginDeliveryStats>,
) -> Vec<serde_json::Value> {
    stats
        .iter()
        .map(|(id, stats)| {
            serde_json::json!({
                "pluginId": id,
                "accepted": stats.accepted,
                "dropped": stats.dropped,
                "completed": stats.completed,
                "failed": stats.failed,
                "timeouts": stats.timeouts,
                "restarts": stats.restarts,
                "queued": stats.queued.max(0),
                "meanLatencyMs": if stats.latency_samples == 0 {
                    serde_json::Value::Null
                } else {
                    serde_json::json!(stats.latency_sum_ms as f64 / stats.latency_samples as f64)
                },
            })
        })
        .collect()
}
