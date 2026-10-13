//! Subscription matching and delivery eligibility policy.
//!
//! Per-event subscription matching now lives in the precomputed
//! [`FanoutCache`](super::fanout::FanoutCache); this module keeps the
//! topic-independent delivery check used for pruning dead workers.

use crate::AppCore;
use tiktools_plugin_api::capabilities::EVENTS_SUBSCRIBE;
use tiktools_plugin_loader::DiscoveredPlugin;

/// Topic-independent delivery eligibility for pruning workers whose plugin
/// can no longer receive events. Per-event fan-out consults the cached
/// static facts plus live generation/readiness reads instead.
pub(crate) fn eligible_for_delivery(core: &AppCore, plugin: &DiscoveredPlugin) -> bool {
    // Declarative packages have no process call boundary and cannot implement
    // the SDK event hook. A plugin must also be both enabled and running;
    // observing events must never resurrect a stopped or crashed instance.
    plugin.manifest.runtime != tiktools_plugin_api::PluginRuntimeKind::Declarative
        && plugin.running
        && core.plugin_ready(&plugin.manifest.id)
        && core
            .capabilities
            .require_capability(&plugin.manifest, EVENTS_SUBSCRIBE)
            .is_ok()
        && !plugin.manifest.event_subscriptions.is_empty()
}
