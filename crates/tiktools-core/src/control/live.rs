//! Live connection lifecycle and live status operations.

#[cfg(feature = "native-tiktok")]
use super::check_session_cookie_len;
use super::OperationError;
use crate::*;
use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    pub connected: bool,
    pub unique_id: Option<String>,
    pub room_id: Option<String>,
    pub connection_id: Option<String>,
    pub native: bool,
}

impl AppCore {
    // ------------------------------------------------------------------
    // Live.
    // ------------------------------------------------------------------

    pub fn live_status(&self) -> LiveStatus {
        let connected = self.live.is_connected();
        #[cfg(feature = "native-tiktok")]
        let native = true;
        #[cfg(not(feature = "native-tiktok"))]
        let native = false;
        #[cfg(feature = "persistence")]
        let context = recover_rwlock_read(&self.connection_context, "connection context").clone();
        #[cfg(not(feature = "persistence"))]
        let context: Option<LiveContext> =
            recover_rwlock_read(&self.connection_context, "connection context").clone();
        #[cfg(feature = "native-tiktok")]
        let context = context.filter(|context| {
            context.connection_id
                == format!("connection-{}", self.live.connection_snapshot().generation)
        });
        LiveStatus {
            connected,
            unique_id: context.as_ref().map(|context| context.unique_id.clone()),
            room_id: context.as_ref().map(|context| context.room_id.clone()),
            connection_id: context.map(|context| context.connection_id),
            native,
        }
    }

    #[cfg(feature = "native-tiktok")]
    pub async fn live_connect(
        self: &Arc<Self>,
        unique_id: String,
        session_cookie: String,
        room_id: Option<String>,
    ) -> Result<LiveStatus, OperationError> {
        let unique_id = clean_unique_id(&unique_id)
            .ok_or_else(|| OperationError::invalid("uniqueId must not be empty"))?;
        check_session_cookie_len(&session_cookie)?;
        if room_id.as_ref().is_some_and(|room| room.len() > 64) {
            return Err(OperationError::invalid("roomId is too long (max 64)"));
        }
        self.start_live_event_pump();
        let (generation, info) = self
            .live
            .connect_generation(ConnectRequest {
                unique_id,
                session_cookie,
                room_id,
            })
            .await
            .map_err(|error| OperationError::unavailable(error.to_string()))?;
        // The ordered transport event worker publishes lifecycle topics.
        // Return the connection values directly even if persistence/UI
        // initialization is still queued; it must not duplicate topics.
        let snapshot = self.live.connection_snapshot();
        if !self.live.is_connected() || snapshot.generation != generation {
            return Ok(self.live_status());
        }
        Ok(LiveStatus {
            connected: true,
            unique_id: Some(info.unique_id),
            room_id: Some(info.room_id),
            connection_id: Some(format!("connection-{}", generation)),
            native: true,
        })
    }

    #[cfg(not(feature = "native-tiktok"))]
    pub async fn live_connect(
        self: &Arc<Self>,
        _unique_id: String,
        _session_cookie: String,
        _room_id: Option<String>,
    ) -> Result<LiveStatus, OperationError> {
        Err(OperationError::unavailable(
            "the native TikTok client is disabled in this build",
        ))
    }

    pub async fn live_disconnect(self: &Arc<Self>) -> LiveStatus {
        self.live.disconnect().await;
        self.live_status()
    }

    /// Picks the top live room for a session cookie and connects to it.
    /// Room choice is deterministic (first of the viewer-ordered rooms).
    #[cfg(feature = "native-tiktok")]
    pub async fn live_pick(
        self: &Arc<Self>,
        session_cookie: String,
    ) -> Result<LiveStatus, OperationError> {
        check_session_cookie_len(&session_cookie)?;
        self.start_live_event_pump();
        let (generation, info) = self
            .live
            .pick_generation(session_cookie)
            .await
            .map_err(|error| OperationError::unavailable(error.to_string()))?;
        if self.live.connection_snapshot().generation != generation || !self.live.is_connected() {
            return Ok(self.live_status());
        }
        Ok(LiveStatus {
            connected: true,
            unique_id: Some(info.unique_id),
            room_id: Some(info.room_id),
            connection_id: Some(format!("connection-{generation}")),
            native: true,
        })
    }

    #[cfg(not(feature = "native-tiktok"))]
    pub async fn live_pick(
        self: &Arc<Self>,
        _session_cookie: String,
    ) -> Result<LiveStatus, OperationError> {
        Err(OperationError::unavailable(
            "the native TikTok client is disabled in this build",
        ))
    }
}
