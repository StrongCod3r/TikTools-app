/**
 * Normalized LIVE emote values and the segment model the renderers consume.
 *
 * These types mirror the `LiveEmote` shape carried by the pinned
 * `tiktok-signer` events. Automation payload types are generated from the
 * Rust contracts; this app-side type also supports UI events and rendering.
 */

/**
 * Where an emote's metadata came from. Provenance only — it is *not* proof the
 * artwork was verified as an official TikTok asset.
 */
export type EmoteSource = 'protobuf' | 'catalog' | 'unknown';

export interface LiveEmote {
  /** Original signer identifier; it may be empty when artwork is available. */
  id: string;
  /** Bracketed token as it appears in the comment, e.g. `[laughcry]`. */
  shortcode?: string;
  /** HTTPS image URL supplied by the event. Validated before it is used. */
  imageUrl?: string;
  /**
   * Original protobuf position. The renderer tries common byte/code point/
   * UTF-16 interpretations and uses it only when exactly one lands at a complete
   * bracket token. It never slices or rewrites the source comment.
   */
  index?: number;
  emoteType?: number;
  packageId?: string;
  source?: EmoteSource;
}

export type TextSegment = {
  type: 'text';
  value: string;
};

export type EmoteSegment = {
  type: 'emote';
  id: string;
  /** Token that was matched in the text, when one was. */
  shortcode?: string;
  /** Validated HTTPS URL, when the event or catalog supplied one. */
  imageUrl?: string;
  /**
   * Plain text fallback, kept as the original shortcode when the event has
   * one. Emote-only messages may have no textual fallback.
   */
  fallbackText: string;
};

export type ChatSegment = TextSegment | EmoteSegment;

/** `true` for segments that render as an inline image. */
export function isEmoteSegment(segment: ChatSegment): segment is EmoteSegment {
  return segment.type === 'emote';
}
