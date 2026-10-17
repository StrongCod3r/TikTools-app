/**
 * Pure text normalisation applied to LIVE chat before it reaches a TTS
 * provider.
 *
 * The pipeline order is fixed and shared with the Rust backend
 * (`backend/src/policy.rs`); both copies are pinned by the cases in
 * `fixtures/sanitizer-cases.json`:
 *
 *   known emote tokens → Unicode emoji → unwanted invisibles → whitespace
 *
 * Only tokens present in the verified catalog are treated as emotes. Arbitrary
 * bracketed text (`[debug]`, `[1,2,3]`, `[username]`) is never touched — the
 * naive `text.replace(/\[[^\]]+\]/g, '')` approach is explicitly rejected.
 *
 * Note the module stays free of plugin/host imports so it can run in the
 * isolated UI preview and in Bun tests without a broker.
 */

import { emoteById, MAX_EMOTE_TOKEN_LENGTH } from './emote-catalog.ts';

export type TtsEmoteSpeechMode = 'remove' | 'describe';

export type TtsTextSanitizerSettings = {
  removeKnownEmotes: boolean;
  removeUnicodeEmoji: boolean;
  removeInvisibleCharacters: boolean;
  collapseWhitespace: boolean;
  emoteSpeechMode: TtsEmoteSpeechMode;
  skipEmptyMessages: boolean;
};

/** Defaults documented in the implementation report. Removal is opt-in for
 *  Unicode emoji only: `Hello 😂` keeps its emoji unless the operator asks. */
export function defaultTtsSanitizerSettings(): TtsTextSanitizerSettings {
  return {
    removeKnownEmotes: true,
    removeUnicodeEmoji: false,
    removeInvisibleCharacters: true,
    collapseWhitespace: true,
    emoteSpeechMode: 'remove',
    skipEmptyMessages: true,
  };
}

/**
 * Whitespace is classified by an explicit shared table rather than the host
 * language's `\s` / `char::is_whitespace` so Rust and TypeScript cannot drift
 * on edge code points (JS `\s` includes U+FEFF, Rust includes U+0085).
 */
export function isTtsWhitespace(codePoint: number): boolean {
  if (
    codePoint === 0x09 || // tab
    codePoint === 0x0a || // LF
    codePoint === 0x0b || // VT
    codePoint === 0x0c || // FF
    codePoint === 0x0d || // CR
    codePoint === 0x20 || // space
    codePoint === 0x85 || // NEL
    codePoint === 0xa0 || // NBSP
    codePoint === 0x1680 ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000 ||
    codePoint === 0xfeff
  ) {
    return true;
  }
  return codePoint >= 0x2000 && codePoint <= 0x200a;
}

/**
 * Characters dropped when `removeInvisibleCharacters` is on: control and
 * format characters that carry no spoken meaning.
 *
 * Zero-width non-joiner (U+200C) and zero-width joiner (U+200D) are
 * deliberately preserved: they are meaningful in Indic and Arabic scripts and
 * inside emoji sequences. Variation selectors (U+FE0E/U+FE0F) are also kept
 * here and are only stripped as part of a whole emoji grapheme.
 */
export function isUnwantedInvisible(codePoint: number): boolean {
  if (codePoint <= 0x08) return true;
  if (codePoint === 0x0b || codePoint === 0x0c) return true;
  if (codePoint >= 0x0e && codePoint <= 0x1f) return true;
  if (codePoint >= 0x7f && codePoint <= 0x9f) return true;
  if (codePoint === 0xad) return true;
  if (codePoint === 0x180e) return true;
  if (codePoint === 0x200b) return true;
  if (codePoint === 0x200e || codePoint === 0x200f) return true;
  if (codePoint >= 0x202a && codePoint <= 0x202e) return true;
  if (codePoint >= 0x2060 && codePoint <= 0x2064) return true;
  if (codePoint >= 0x2066 && codePoint <= 0x2069) return true;
  if (codePoint === 0xfeff) return true;
  if (codePoint >= 0xfff9 && codePoint <= 0xfffb) return true;
  return false;
}

const EMOJI_DEFAULT_RANGES: readonly (readonly [number, number])[] = [
  [0x231a, 0x231b],
  [0x23e9, 0x23fa],
  [0x24c2, 0x24c2],
  [0x25aa, 0x25ab],
  [0x25b6, 0x25b6],
  [0x25c0, 0x25c0],
  [0x25fb, 0x25fe],
  [0x2600, 0x27bf],
  [0x2934, 0x2935],
  [0x2b05, 0x2b55],
  [0x3030, 0x3030],
  [0x303d, 0x303d],
  [0x3297, 0x3297],
  [0x3299, 0x3299],
  [0x1f000, 0x1faff],
];

const VARIATION_SELECTOR_16 = 0xfe0f;
const KEYCAP = 0x20e3;

/** `true` for code points that are emoji-presentation by default. */
export function isEmojiDefault(codePoint: number): boolean {
  for (const [lo, hi] of EMOJI_DEFAULT_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/**
 * `true` when a whole grapheme cluster should count as one emoji. Text-default
 * pictographs (`©`, `®`, `™`, arrows) only qualify when they carry U+FE0F, so
 * `©` is preserved while `©️` is removed — matching Unicode presentation.
 */
export function isEmojiGrapheme(grapheme: string): boolean {
  let hasVariation16 = false;
  let hasKeycap = false;
  for (const char of grapheme) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint === VARIATION_SELECTOR_16) hasVariation16 = true;
    else if (codePoint === KEYCAP) hasKeycap = true;
    else if (isEmojiDefault(codePoint)) return true;
  }
  return hasVariation16 || hasKeycap;
}

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined;

/** Grapheme clusters, with a code-point fallback for hosts without
 *  `Intl.Segmenter`. The fallback loses ZWJ-sequence grouping only. */
function graphemes(text: string): string[] {
  if (segmenter) {
    const out: string[] = [];
    for (const part of segmenter.segment(text)) out.push(part.segment);
    return out;
  }
  return Array.from(text);
}

/**
 * Replaces or drops known emote shortcodes. Unknown bracketed text passes
 * through untouched, which is the whole point of using the catalog.
 */
export function stripKnownEmotes(text: string, mode: TtsEmoteSpeechMode): string {
  let result = '';
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('[', index);
    if (open === -1) {
      result += text.slice(index);
      break;
    }
    result += text.slice(index, open);
    const close = text.indexOf(']', open + 1);
    if (close === -1) {
      result += text.slice(open);
      break;
    }
    const token = text.slice(open + 1, close);
    const entry =
      token.length > 0 && token.length <= MAX_EMOTE_TOKEN_LENGTH ? emoteById(token) : undefined;
    if (!entry) {
      result += text.slice(open, close + 1);
    } else if (mode === 'describe') {
      result += ` ${entry.description} `;
    }
    index = close + 1;
  }
  return result;
}

export function stripUnicodeEmoji(text: string): string {
  let out = '';
  for (const grapheme of graphemes(text)) {
    if (!isEmojiGrapheme(grapheme)) out += grapheme;
  }
  return out;
}

export function stripUnwantedInvisible(text: string): string {
  let out = '';
  for (const char of text) {
    if (!isUnwantedInvisible(char.codePointAt(0) ?? 0)) out += char;
  }
  return out;
}

/** Collapses every whitespace run to a single space and trims the ends. */
export function collapseTtsWhitespace(text: string): string {
  let out = '';
  let pendingSpace = false;
  for (const char of text) {
    if (isTtsWhitespace(char.codePointAt(0) ?? 0)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      pendingSpace = false;
    }
    out += char;
  }
  return out;
}

/** Full sanitizer. Returns the text that may be spoken; `''` means silence. */
export function sanitizeTtsText(text: string, settings: TtsTextSanitizerSettings): string {
  let result = text;
  if (settings.removeKnownEmotes) {
    result = stripKnownEmotes(result, settings.emoteSpeechMode);
  }
  if (settings.removeUnicodeEmoji) {
    result = stripUnicodeEmoji(result);
  }
  if (settings.removeInvisibleCharacters) {
    result = stripUnwantedInvisible(result);
  }
  if (settings.collapseWhitespace) {
    result = collapseTtsWhitespace(result);
  }
  return result;
}

/**
 * `true` when nothing speakable remains. Whitespace-only counts as empty so an
 * emote-only comment such as `" [laughcry] "` still drops when whitespace
 * collapsing is disabled.
 */
export function isBlankTtsText(text: string): boolean {
  for (const char of text) {
    if (!isTtsWhitespace(char.codePointAt(0) ?? 0)) return false;
  }
  return true;
}
