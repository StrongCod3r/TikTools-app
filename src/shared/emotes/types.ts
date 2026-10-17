/**
 * Normalized LIVE emote values and the segment model the renderers consume.
 *
 * These types are the app-side mirror of the `LiveEmote` shape the
 * `tiktok-signer` event contracts will carry. Nothing here is generated: the
 * automation contract cannot express a repeated message projection yet (see
 * `crates/tiktools-core/src/contracts/tiktok/validation.rs`), so the emote
 * path is defined by hand and stays optional end to end.
 */

/**
 * Where an emote's metadata came from. Provenance only — it is *not* proof the
 * artwork was verified as an official TikTok asset.
 */
export type EmoteSource = 'protobuf' | 'catalog' | 'unknown';

export interface LiveEmote {
  /** Stable emote identifier. Required; an emote without an id is dropped. */
  id: string;
  /** Bracketed token as it appears in the comment, e.g. `[laughcry]`. */
  shortcode?: string;
  /** HTTPS image URL supplied by the event. Validated before it is used. */
  imageUrl?: string;
  /**
   * Original protobuf position. Preserved verbatim and never used to slice
   * text: the unit (bytes, code points, UTF-16) is unverified, so slicing on
   * it could corrupt non-BMP text. Matching is token-based instead.
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
   * Plain text to show when there is no usable image. Always the original
   * shortcode so the comment never loses information.
   */
  fallbackText: string;
};

export type ChatSegment = TextSegment | EmoteSegment;

/** `true` for segments that render as an inline image. */
export function isEmoteSegment(segment: ChatSegment): segment is EmoteSegment {
  return segment.type === 'emote';
}
