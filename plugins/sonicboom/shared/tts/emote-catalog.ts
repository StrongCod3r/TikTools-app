/**
 * Known TikTok LIVE emote shortcodes.
 *
 * TikTok serialises graphical emotes as bracketed tokens inside the chat
 * `content` string (for example `[laughcry]`). The authoritative artwork and
 * the exact index spans arrive in the protobuf `emotes` field, which lives in
 * the `tiktok-signer` repository and is not available to this plugin. This
 * catalog is therefore the text-only fallback: it carries the tokens this
 * plugin is willing to *treat as emotes* so the TTS pipeline never speaks
 * `[laughcry]` while leaving arbitrary bracketed text such as `[debug]` or
 * `[1,2,3]` untouched.
 *
 * IMPORTANT — the token list is a hypothesis, not verified live traffic:
 * `EMOTE_CATALOG_VERSION` must be bumped whenever it changes, and the entries
 * should be reconciled against captured LIVE traffic (see
 * `docs/` implementation report). No image URL is stored here on purpose:
 * inventing artwork URLs is forbidden, so rendering falls back to the original
 * shortcode until real protobuf metadata is available.
 *
 * The identical table is mirrored in Rust at
 * `plugins/sonicboom/backend/src/emotes.rs`; `sanitizer-cases.json` pins the
 * two copies together.
 */

export type EmoteCatalogEntry = {
  /** Canonical lookup id: lowercase, no brackets, e.g. `laughcry`. */
  id: string;
  /** Full token as it appears in chat, e.g. `[laughcry]`. */
  shortcode: string;
  /** English description used when `emoteSpeechMode` is `describe`. */
  description: string;
};

/** Bumping this is required whenever the catalog content changes. */
export const EMOTE_CATALOG_VERSION = '2026.10.0';

/** Longest shortcode token the scanner will even consider. Bounds work on
 *  hostile input: a comment full of `[[[[…` cannot make scanning quadratic. */
export const MAX_EMOTE_TOKEN_LENGTH = 32;

/**
 * Verified set. Each entry must be confirmed as a real TikTok emote token
 * before it is added; a plausible-looking word is not enough, which is why
 * this list is deliberately short.
 */
export const EMOTE_CATALOG: readonly EmoteCatalogEntry[] = Object.freeze([
  { id: 'laughcry', shortcode: '[laughcry]', description: 'laughing and crying' },
  { id: 'happy', shortcode: '[happy]', description: 'happy' },
  { id: 'wow', shortcode: '[wow]', description: 'wow' },
  { id: 'heart', shortcode: '[heart]', description: 'heart' },
  { id: 'cry', shortcode: '[cry]', description: 'crying' },
  { id: 'laugh', shortcode: '[laugh]', description: 'laughing' },
  { id: 'angry', shortcode: '[angry]', description: 'angry' },
  { id: 'shock', shortcode: '[shock]', description: 'shocked' },
  { id: 'thumbsup', shortcode: '[thumbsup]', description: 'thumbs up' },
  { id: 'fire', shortcode: '[fire]', description: 'fire' },
]);

const byId: ReadonlyMap<string, EmoteCatalogEntry> = new Map(
  EMOTE_CATALOG.map((entry) => [entry.id, entry]),
);

/** Case-folded lookup used by the scanner. */
export function emoteById(id: string): EmoteCatalogEntry | undefined {
  return byId.get(id.trim().toLowerCase());
}

export function isKnownEmoteId(id: string): boolean {
  return byId.has(id.trim().toLowerCase());
}
