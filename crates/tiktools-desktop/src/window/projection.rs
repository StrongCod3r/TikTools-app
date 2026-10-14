//! Main-page presentation policy. Domain/plugin/control subscribers are unchanged.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

#[derive(Clone, Copy, Debug)]
pub(crate) struct PageView {
    pub generation: u64,
    pub revision: u64,
    pub feed: bool,
    pub behavior: bool,
    pub points: bool,
    pub visible: bool,
}

pub(crate) struct MainPageProjection {
    view: Mutex<PageView>,
    host_visible: std::sync::atomic::AtomicBool,
    pub source: AtomicU64,
    pub filtered: AtomicU64,
    pub feed_suspended: AtomicU64,
    pub points_coalesced: AtomicU64,
    pub runs_coalesced: AtomicU64,
    pub snapshots: AtomicU64,
    pub lossy_skipped: AtomicU64,
    pub feed_bus_dropped: AtomicU64,
    pub feed_forwarded: AtomicU64,
    #[cfg(feature = "live-benchmark")]
    pub disable_points: std::sync::atomic::AtomicBool,
}

impl Default for MainPageProjection {
    fn default() -> Self {
        Self {
            view: Mutex::new(PageView {
                generation: 0,
                revision: 0,
                feed: false,
                behavior: false,
                points: false,
                visible: false,
            }),
            host_visible: std::sync::atomic::AtomicBool::new(true),
            source: AtomicU64::new(0),
            filtered: AtomicU64::new(0),
            feed_suspended: AtomicU64::new(0),
            points_coalesced: AtomicU64::new(0),
            runs_coalesced: AtomicU64::new(0),
            snapshots: AtomicU64::new(0),
            lossy_skipped: AtomicU64::new(0),
            feed_bus_dropped: AtomicU64::new(0),
            feed_forwarded: AtomicU64::new(0),
            #[cfg(feature = "live-benchmark")]
            disable_points: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

impl MainPageProjection {
    pub fn view(&self) -> PageView {
        let mut view = *self.view.lock().unwrap_or_else(|e| e.into_inner());
        view.visible &= self.host_visible.load(Ordering::Acquire);
        #[cfg(feature = "live-benchmark")]
        {
            view.points &= !self.disable_points.load(Ordering::Relaxed);
        }
        view
    }
    pub fn retire(&self, generation: u64) {
        *self.view.lock().unwrap_or_else(|e| e.into_inner()) = PageView {
            generation,
            revision: 0,
            feed: false,
            behavior: false,
            points: false,
            visible: false,
        };
    }
    pub fn set_host_visible(&self, visible: bool) {
        self.host_visible.store(visible, Ordering::Release);
    }
    pub fn update(
        &self,
        generation: u64,
        revision: u64,
        feed: bool,
        behavior: bool,
        points: bool,
        visible: bool,
    ) -> bool {
        let mut view = self.view.lock().unwrap_or_else(|e| e.into_inner());
        if generation != view.generation || revision <= view.revision {
            return false;
        }
        *view = PageView {
            generation,
            revision,
            feed,
            behavior,
            points,
            visible,
        };
        true
    }
    pub fn diagnostics(&self) -> serde_json::Value {
        let view = self.view();
        serde_json::json!({"generation": view.generation, "revision": view.revision,
            "feed": view.feed, "behavior": view.behavior, "points": view.points, "visible": view.visible,
            "sourceEvents": self.source.load(Ordering::Relaxed),
            "filteredEvents": self.filtered.load(Ordering::Relaxed),
            "feedSuspended": self.feed_suspended.load(Ordering::Relaxed),
            "pointsCoalesced": self.points_coalesced.load(Ordering::Relaxed),
            "runsCoalesced": self.runs_coalesced.load(Ordering::Relaxed),
            "lossyDomainSkipped": self.lossy_skipped.load(Ordering::Relaxed),
            "feedBusDropped": self.feed_bus_dropped.load(Ordering::Relaxed),
            "feedForwarded": self.feed_forwarded.load(Ordering::Relaxed),
            "snapshots": self.snapshots.load(Ordering::Relaxed)})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn late_view_requests_and_retired_pages_cannot_restore_delivery() {
        let policy = MainPageProjection::default();
        assert!(policy.update(0, 2, true, false, true, true));
        assert!(!policy.update(0, 1, false, true, false, true));
        policy.retire(1);
        assert!(!policy.update(0, 3, true, true, true, true));
        assert!(!policy.view().visible);
        assert!(policy.update(1, 1, true, false, true, true));
        policy.set_host_visible(false);
        assert!(!policy.view().visible);
        policy.set_host_visible(true);
        assert!(policy.view().feed);
    }
}
