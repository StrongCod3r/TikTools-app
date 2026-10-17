//! Known TikTok LIVE emote shortcodes — the Rust mirror of
//! `shared/tts/emote-catalog.ts`.
//!
//! TikTok serialises graphical emotes as bracketed tokens inside the chat
//! `content` string (for example `[laughcry]`). The authoritative artwork and
//! index spans arrive in the protobuf `emotes` field, which lives in the
//! `tiktok-signer` repository; this catalog is the text-only fallback that
//! stops the speech pipeline from speaking `[laughcry]` while leaving
//! arbitrary bracketed text alone.
//!
//! The token list is a hypothesis, not verified live traffic. Bump
//! [`EMOTE_CATALOG_VERSION`] whenever it changes, and reconcile it against
//! captured LIVE traffic. The identical table is mirrored in TypeScript and
//! both copies are pinned by `shared/tts/fixtures/sanitizer-cases.json`.

/// Bumping this is required whenever the catalog content changes. It is a
/// documentation/debugging anchor consumed by the shared-fixture parity test;
/// the running binary never branches on it, so it is allowed to be unused in
/// release builds (same convention as `policy::Decision`).
#[allow(dead_code)]
pub const EMOTE_CATALOG_VERSION: &str = "2026.10.0";

/// Longest shortcode token the scanner will consider. Bounds work on hostile
/// input so a comment full of `[[[[…` cannot make scanning quadratic.
pub const MAX_EMOTE_TOKEN_LENGTH: usize = 32;

pub struct EmoteCatalogEntry {
    /// Canonical lookup id: lowercase, no brackets, e.g. `laughcry`.
    pub id: &'static str,
    /// English description used when the speech mode is `describe`.
    pub description: &'static str,
}

/// Verified entries. Each must be confirmed as a real TikTok emote token
/// before it is added; a plausible-looking word is not enough, which is why
/// this list is deliberately short.
pub const EMOTE_CATALOG: &[EmoteCatalogEntry] = &[
    EmoteCatalogEntry {
        id: "laughcry",
        description: "laughing and crying",
    },
    EmoteCatalogEntry {
        id: "happy",
        description: "happy",
    },
    EmoteCatalogEntry {
        id: "wow",
        description: "wow",
    },
    EmoteCatalogEntry {
        id: "heart",
        description: "heart",
    },
    EmoteCatalogEntry {
        id: "cry",
        description: "crying",
    },
    EmoteCatalogEntry {
        id: "laugh",
        description: "laughing",
    },
    EmoteCatalogEntry {
        id: "angry",
        description: "angry",
    },
    EmoteCatalogEntry {
        id: "shock",
        description: "shocked",
    },
    EmoteCatalogEntry {
        id: "thumbsup",
        description: "thumbs up",
    },
    EmoteCatalogEntry {
        id: "fire",
        description: "fire",
    },
];

/// Case-folded lookup, mirroring `emoteById`.
pub fn emote_by_id(id: &str) -> Option<&'static EmoteCatalogEntry> {
    let needle = id.trim();
    if needle.is_empty() {
        return None;
    }
    let lowered = needle.to_lowercase();
    EMOTE_CATALOG.iter().find(|entry| entry.id == lowered)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_lowercase_and_bounded() {
        let mut seen = std::collections::HashSet::new();
        for entry in EMOTE_CATALOG {
            assert!(seen.insert(entry.id), "duplicate id {}", entry.id);
            assert_eq!(entry.id, entry.id.to_lowercase());
            assert!(!entry.description.is_empty());
            assert!(entry.id.len() <= MAX_EMOTE_TOKEN_LENGTH);
        }
    }

    #[test]
    fn lookup_is_case_insensitive_and_trimmed() {
        assert!(emote_by_id("  LAUGHCRY ").is_some());
        assert!(emote_by_id("Happy").is_some());
        assert!(emote_by_id("not-an-emote").is_none());
        assert!(emote_by_id("").is_none());
    }
}
