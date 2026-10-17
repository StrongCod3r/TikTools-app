//! Pure text normalisation applied to LIVE chat before it reaches a TTS
//! provider.
//!
//! The pipeline order is fixed and shared with the TypeScript copy
//! (`shared/tts/sanitizer.ts`); both are pinned by
//! `shared/tts/fixtures/sanitizer-cases.json`, which the test at the bottom of
//! this file replays against this implementation:
//!
//!   known emote tokens → Unicode emoji → unwanted invisibles → whitespace
//!
//! Character classification uses explicit tables rather than
//! `char::is_whitespace()` / Unicode properties so the two languages cannot
//! drift on edge code points.

use unicode_segmentation::UnicodeSegmentation;

use crate::emotes::{emote_by_id, MAX_EMOTE_TOKEN_LENGTH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmoteSpeechMode {
    Remove,
    Describe,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TtsTextSanitizerSettings {
    pub remove_known_emotes: bool,
    pub remove_unicode_emoji: bool,
    pub remove_invisible_characters: bool,
    pub collapse_whitespace: bool,
    pub emote_speech_mode: EmoteSpeechMode,
    pub skip_empty_messages: bool,
}

impl Default for TtsTextSanitizerSettings {
    fn default() -> Self {
        Self {
            remove_known_emotes: true,
            remove_unicode_emoji: false,
            remove_invisible_characters: true,
            collapse_whitespace: true,
            emote_speech_mode: EmoteSpeechMode::Remove,
            skip_empty_messages: true,
        }
    }
}

/// Whitespace is classified by an explicit shared table; JS `\s` includes
/// U+FEFF while Rust's `char::is_whitespace` includes U+0085, so neither
/// built-in agrees with the other.
pub fn is_tts_whitespace(ch: char) -> bool {
    let cp = ch as u32;
    matches!(
        cp,
        0x09 | 0x0a
            | 0x0b
            | 0x0c
            | 0x0d
            | 0x20
            | 0x85
            | 0xa0
            | 0x1680
            | 0x2028
            | 0x2029
            | 0x202f
            | 0x205f
            | 0x3000
            | 0xfeff
    ) || (0x2000..=0x200a).contains(&cp)
}

/// Control and format characters that carry no spoken meaning.
///
/// Zero-width non-joiner (U+200C) and zero-width joiner (U+200D) are
/// deliberately preserved: they are meaningful in Indic and Arabic scripts and
/// inside emoji sequences. Variation selectors (U+FE0E/U+FE0F) are kept here
/// and only stripped as part of a whole emoji grapheme.
pub fn is_unwanted_invisible(ch: char) -> bool {
    let cp = ch as u32;
    if cp <= 0x08 {
        return true;
    }
    if cp == 0x0b || cp == 0x0c {
        return true;
    }
    if (0x0e..=0x1f).contains(&cp) {
        return true;
    }
    if (0x7f..=0x9f).contains(&cp) {
        return true;
    }
    matches!(cp, 0xad | 0x180e | 0x200b | 0x200e | 0x200f | 0xfeff)
        || (0x202a..=0x202e).contains(&cp)
        || (0x2060..=0x2064).contains(&cp)
        || (0x2066..=0x2069).contains(&cp)
        || (0xfff9..=0xfffb).contains(&cp)
}

const EMOJI_DEFAULT_RANGES: &[(u32, u32)] = &[
    (0x231a, 0x231b),
    (0x23e9, 0x23fa),
    (0x24c2, 0x24c2),
    (0x25aa, 0x25ab),
    (0x25b6, 0x25b6),
    (0x25c0, 0x25c0),
    (0x25fb, 0x25fe),
    (0x2600, 0x27bf),
    (0x2934, 0x2935),
    (0x2b05, 0x2b55),
    (0x3030, 0x3030),
    (0x303d, 0x303d),
    (0x3297, 0x3297),
    (0x3299, 0x3299),
    (0x1f000, 0x1faff),
];

const VARIATION_SELECTOR_16: u32 = 0xfe0f;
const KEYCAP: u32 = 0x20e3;

/// `true` for code points that are emoji-presentation by default.
pub fn is_emoji_default(ch: char) -> bool {
    let cp = ch as u32;
    EMOJI_DEFAULT_RANGES
        .iter()
        .any(|(lo, hi)| (*lo..=*hi).contains(&cp))
}

/// `true` when a whole grapheme cluster should count as one emoji.
/// Text-default pictographs (`©`, `®`, `™`, arrows) only qualify when they
/// carry U+FE0F, so `©` is preserved while `©️` is removed.
pub fn is_emoji_grapheme(grapheme: &str) -> bool {
    let mut has_variation16 = false;
    let mut has_keycap = false;
    for ch in grapheme.chars() {
        let cp = ch as u32;
        if cp == VARIATION_SELECTOR_16 {
            has_variation16 = true;
        } else if cp == KEYCAP {
            has_keycap = true;
        } else if is_emoji_default(ch) {
            return true;
        }
    }
    has_variation16 || has_keycap
}

/// Replaces or drops known emote shortcodes. Unknown bracketed text passes
/// through untouched, which is the whole point of using the catalog: the naive
/// `replace(/\[[^\]]+\]/g, "")` approach is explicitly rejected.
pub fn strip_known_emotes(text: &str, mode: EmoteSpeechMode) -> String {
    let mut out = String::with_capacity(text.len());
    let mut index = 0usize;
    while index < text.len() {
        let Some(open_offset) = text[index..].find('[') else {
            out.push_str(&text[index..]);
            break;
        };
        let open = index + open_offset;
        out.push_str(&text[index..open]);
        let Some(close_offset) = text[open + 1..].find(']') else {
            out.push_str(&text[open..]);
            break;
        };
        let close = open + 1 + close_offset;
        let token = &text[open + 1..close];
        let entry = if !token.is_empty() && token.chars().count() <= MAX_EMOTE_TOKEN_LENGTH {
            emote_by_id(token)
        } else {
            None
        };
        match entry {
            None => out.push_str(&text[open..=close]),
            Some(entry) => {
                if mode == EmoteSpeechMode::Describe {
                    out.push(' ');
                    out.push_str(entry.description);
                    out.push(' ');
                }
            }
        }
        index = close + 1;
    }
    out
}

pub fn strip_unicode_emoji(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for grapheme in UnicodeSegmentation::graphemes(text, true) {
        if !is_emoji_grapheme(grapheme) {
            out.push_str(grapheme);
        }
    }
    out
}

pub fn strip_unwanted_invisible(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if !is_unwanted_invisible(ch) {
            out.push(ch);
        }
    }
    out
}

/// Collapses every whitespace run to a single space and trims the ends.
pub fn collapse_tts_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_space = false;
    for ch in text.chars() {
        if is_tts_whitespace(ch) {
            pending_space = !out.is_empty();
            continue;
        }
        if pending_space {
            out.push(' ');
            pending_space = false;
        }
        out.push(ch);
    }
    out
}

/// Full sanitizer. Returns the text that may be spoken; `""` means silence.
pub fn sanitize_tts_text(text: &str, settings: &TtsTextSanitizerSettings) -> String {
    let mut result = text.to_owned();
    if settings.remove_known_emotes {
        result = strip_known_emotes(&result, settings.emote_speech_mode);
    }
    if settings.remove_unicode_emoji {
        result = strip_unicode_emoji(&result);
    }
    if settings.remove_invisible_characters {
        result = strip_unwanted_invisible(&result);
    }
    if settings.collapse_whitespace {
        result = collapse_tts_whitespace(&result);
    }
    result
}

/// `true` when nothing speakable remains. Whitespace-only counts as empty so
/// an emote-only comment still drops when whitespace collapsing is disabled.
pub fn is_blank_tts_text(text: &str) -> bool {
    text.chars().all(is_tts_whitespace)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// The shared fixture file both language implementations replay.
    const FIXTURES: &str = include_str!("../../shared/tts/fixtures/sanitizer-cases.json");

    fn settings_from(defaults: &Value, override_json: Option<&Value>) -> TtsTextSanitizerSettings {
        let mut settings = TtsTextSanitizerSettings {
            remove_known_emotes: defaults["removeKnownEmotes"].as_bool().unwrap_or(true),
            remove_unicode_emoji: defaults["removeUnicodeEmoji"].as_bool().unwrap_or(false),
            remove_invisible_characters: defaults["removeInvisibleCharacters"]
                .as_bool()
                .unwrap_or(true),
            collapse_whitespace: defaults["collapseWhitespace"].as_bool().unwrap_or(true),
            emote_speech_mode: match defaults["emoteSpeechMode"].as_str() {
                Some("describe") => EmoteSpeechMode::Describe,
                _ => EmoteSpeechMode::Remove,
            },
            skip_empty_messages: defaults["skipEmptyMessages"].as_bool().unwrap_or(true),
        };
        if let Some(Value::Object(overrides)) = override_json {
            if let Some(value) = overrides.get("removeKnownEmotes").and_then(Value::as_bool) {
                settings.remove_known_emotes = value;
            }
            if let Some(value) = overrides.get("removeUnicodeEmoji").and_then(Value::as_bool) {
                settings.remove_unicode_emoji = value;
            }
            if let Some(value) = overrides
                .get("removeInvisibleCharacters")
                .and_then(Value::as_bool)
            {
                settings.remove_invisible_characters = value;
            }
            if let Some(value) = overrides.get("collapseWhitespace").and_then(Value::as_bool) {
                settings.collapse_whitespace = value;
            }
            if let Some(value) = overrides.get("skipEmptyMessages").and_then(Value::as_bool) {
                settings.skip_empty_messages = value;
            }
            if let Some(value) = overrides.get("emoteSpeechMode").and_then(Value::as_str) {
                settings.emote_speech_mode = match value {
                    "describe" => EmoteSpeechMode::Describe,
                    _ => EmoteSpeechMode::Remove,
                };
            }
        }
        settings
    }

    #[test]
    fn shared_fixture_defaults_match_the_shipped_defaults() {
        let parsed: Value = serde_json::from_str(FIXTURES).expect("fixtures parse");
        let defaults = settings_from(&parsed["defaults"], None);
        assert_eq!(defaults, TtsTextSanitizerSettings::default());
        assert_eq!(
            parsed["catalogVersion"].as_str(),
            Some(crate::emotes::EMOTE_CATALOG_VERSION)
        );
    }

    #[test]
    fn shared_fixture_cases_hold() {
        let parsed: Value = serde_json::from_str(FIXTURES).expect("fixtures parse");
        let defaults = &parsed["defaults"];
        let cases = parsed["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty());
        for case in cases {
            let name = case["name"].as_str().unwrap_or("<unnamed>");
            let input = case["input"].as_str().expect("input string");
            let expected = case["expected"].as_str().expect("expected string");
            let settings = settings_from(defaults, case.get("override"));
            assert_eq!(
                sanitize_tts_text(input, &settings),
                expected,
                "fixture case failed: {name}"
            );
        }
    }

    #[test]
    fn strip_known_emotes_never_touches_arbitrary_brackets() {
        for token in ["[debug]", "[1,2,3]", "[username]", "[]", "[a b]"] {
            let input = format!("x {token} y");
            assert_eq!(strip_known_emotes(&input, EmoteSpeechMode::Remove), input);
        }
    }

    #[test]
    fn strip_known_emotes_handles_partial_tokens() {
        assert_eq!(
            strip_known_emotes("x [wow", EmoteSpeechMode::Remove),
            "x [wow"
        );
        assert_eq!(
            strip_known_emotes("x wow]", EmoteSpeechMode::Remove),
            "x wow]"
        );
        assert_eq!(
            strip_known_emotes("a[happy]b", EmoteSpeechMode::Describe),
            "a happy b"
        );
    }

    #[test]
    fn joiners_are_never_unwanted_invisibles() {
        assert!(!is_unwanted_invisible('\u{200c}'));
        assert!(!is_unwanted_invisible('\u{200d}'));
        assert!(!is_unwanted_invisible('\u{fe0f}'));
        assert!(is_unwanted_invisible('\u{200b}'));
        assert!(is_unwanted_invisible('\u{feff}'));
        assert!(is_unwanted_invisible('\u{ad}'));
        assert!(!is_unwanted_invisible('A'));
    }

    #[test]
    fn whitespace_table_covers_the_shared_set() {
        for ch in [
            '\t', '\n', '\u{0b}', '\u{0c}', '\r', ' ', '\u{85}', '\u{a0}', '\u{3000}', '\u{feff}',
        ] {
            assert!(is_tts_whitespace(ch), "expected whitespace: {ch:?}");
        }
        for ch in ['A', '\u{200b}', '\u{200c}', '\u{200d}', '😂'] {
            assert!(!is_tts_whitespace(ch), "expected non-whitespace: {ch:?}");
        }
    }

    #[test]
    fn emoji_removal_keeps_scripts_and_drops_sequences() {
        assert_eq!(strip_unicode_emoji("hi 👋 there"), "hi  there");
        assert_eq!(strip_unicode_emoji("© ® ™ ↔"), "© ® ™ ↔");
        assert_eq!(strip_unicode_emoji("flag 🇲🇽 here"), "flag  here");
        assert_eq!(
            strip_unicode_emoji("こんにちは 세계 مرحبا"),
            "こんにちは 세계 مرحبا"
        );
    }

    #[test]
    fn blankness_treats_whitespace_only_as_empty() {
        assert!(is_blank_tts_text(""));
        assert!(is_blank_tts_text(" \t\n "));
        assert!(!is_blank_tts_text(" a "));
    }
}
