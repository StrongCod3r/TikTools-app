use crate::*;

impl AppCore {
    #[cfg(feature = "native-tiktok")]
    pub(crate) fn start_live_event_pump(self: &Arc<Self>) {
        if self.live_pump_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let mut receiver = self.live.subscribe();
        let core = Arc::clone(self);
        tracing::info!("native TikTok event pump started");
        let shutdown = self.plugin_state.observer_shutdown.clone();
        let task = tokio::spawn(async move {
            loop {
                let event = tokio::select! {
                    biased;
                    () = shutdown.cancelled() => break,
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
                            () = shutdown.cancelled() => break,
                            () = core.handle_native_event(event) => {},
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                        core.record_event_gap();
                        tracing::warn!(count, "native TikTok event receiver lagged; analytics and event stream incomplete")
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        tracing::warn!("native TikTok event stream closed");
                        break;
                    }
                }
            }
        });
        *recover_mutex(&self.live_pump_task, "LIVE pump") = Some(task);
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
    }
}
