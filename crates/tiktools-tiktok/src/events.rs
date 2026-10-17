//! TikTools' enrichment boundary around the canonical `ttl-live-events` API.
//!
//! `ttl-live-events` owns the normalized TikTok event contracts. This module
//! adds only values that belong to the application transport: the raw envelope
//! metadata and the gift catalog lookup used to fill repeat-gift messages.

use std::collections::HashMap;

use crate::GiftInfo;

pub use ttl_live_events::{
    ChatEvent, EventUser, GiftEvent, LikeEvent, LiveEvent as CanonicalLiveEvent, MemberEvent,
    RoomUserEvent, SocialEvent, TopViewer,
};

pub use ttl_live_events::social::SocialKind;

/// The single `action` -> kind table for the application.
///
/// Classification is driven by `action` alone; `follow_count`/`share_count` are
/// cumulative room totals, not per-event increments, so deciding by "the first
/// positive counter" would mislabel every share in a room that has any
/// follower. Delegates to the canonical `ttl-live-events` classifier so the
/// application mirror cannot drift from the crates it consumes.
pub fn classify_social_action(action: i64) -> SocialKind {
    ttl_live_events::social::classify_action(action).kind
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventMetadata {
    pub method: String,
    pub msg_id: u64,
    pub is_history: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GiftEnrichment {
    pub name: String,
    pub diamond_count: u64,
    pub streakable: bool,
    pub icon_url: Option<String>,
}

/// One canonical normalized event plus TikTools-only enrichment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TikToolsEvent {
    pub base: ttl_live_events::LiveEvent,
    pub metadata: EventMetadata,
    pub gift: Option<GiftEnrichment>,
}

impl TikToolsEvent {
    pub fn from_decoded(
        decoded: ttl_live_events::DecodedEvent,
        gifts: &HashMap<String, GiftInfo>,
    ) -> Self {
        let metadata = EventMetadata {
            method: decoded.raw.method,
            msg_id: decoded.raw.msg_id,
            is_history: decoded.raw.is_history,
        };
        let gift =
            match &decoded.event {
                ttl_live_events::LiveEvent::Gift(event) => gifts
                    .get(&event.gift_id.to_string())
                    .map(|gift| GiftEnrichment {
                        name: gift.name.clone(),
                        diamond_count: gift.diamond_count,
                        streakable: gift.streakable,
                        icon_url: gift.icon_url.clone(),
                    }),
                _ => None,
            };
        Self {
            base: decoded.event,
            metadata,
            gift,
        }
    }

    pub fn user(&self) -> Option<&EventUser> {
        self.base.user()
    }

    pub fn method(&self) -> &str {
        &self.metadata.method
    }

    pub fn msg_id(&self) -> u64 {
        self.metadata.msg_id
    }

    pub fn is_history(&self) -> bool {
        self.metadata.is_history
    }

    pub fn gift_name(&self) -> Option<&str> {
        let ttl_live_events::LiveEvent::Gift(event) = &self.base else {
            return None;
        };
        if !event.gift_name.is_empty() {
            return Some(event.gift_name.as_str());
        }
        self.gift
            .as_ref()
            .map(|gift| gift.name.as_str())
            .filter(|name| !name.is_empty())
            .or(Some("Gift"))
    }

    pub fn gift_diamond_count(&self) -> Option<u64> {
        let ttl_live_events::LiveEvent::Gift(event) = &self.base else {
            return None;
        };
        Some(if event.diamond_count == 0 {
            self.gift
                .as_ref()
                .map(|gift| gift.diamond_count)
                .unwrap_or_default()
        } else {
            event.diamond_count
        })
    }

    pub fn gift_streakable(&self) -> bool {
        self.gift.as_ref().is_some_and(|gift| gift.streakable)
    }

    pub fn gift_icon_url(&self) -> Option<&str> {
        self.gift.as_ref().and_then(|gift| gift.icon_url.as_deref())
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_social_action, SocialKind};

    /// The same table the `tiktok-signer` fixture pins. Duplicated here only
    /// because the fixture lives in the other repository.
    #[test]
    fn action_table_is_follow_share_or_unclassified() {
        assert_eq!(classify_social_action(1), SocialKind::Follow);
        assert_eq!(classify_social_action(3), SocialKind::Share);
        assert_eq!(classify_social_action(0), SocialKind::Unknown);
        for code in [-1, 2, 4, 5, 8, 97, i64::MAX] {
            assert_eq!(
                classify_social_action(code),
                SocialKind::Other,
                "action {code} must stay unclassified"
            );
        }
    }

    /// The counters are cumulative room totals; they must never influence the
    /// kind. This is the classifier contract that the counters cannot reach.
    #[test]
    fn the_table_has_no_counter_inputs() {
        // The signature is the guarantee: only `action` is consulted.
        let _: fn(i64) -> SocialKind = classify_social_action;
    }
}
