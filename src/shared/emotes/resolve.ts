/**
 * Resolves a chat comment plus its optional emote metadata into render
 * segments and TTS-safe text.
 *
 * Resolution priority (highest first):
 *   1. explicit protobuf emote metadata whose token appears in the comment;
 *   2. the verified shortcode catalog;
 *   3. plain text — the original shortcode, never a fabricated image.
 *
 * Matching is token-based rather than index-based. `EmoteWithIndex.index`
 * semantics are unverified (bytes, code points, or UTF-16 are all plausible),
 * and slicing on a wrong unit would corrupt any comment containing non-BMP
 * text, so the index is carried as metadata only. This is the safe textual
 * fallback the plan calls for, and it never loses the original text.
 */

import {
  MAX_EMOTE_TOKEN_LENGTH,
  catalogEmoteById,
} from './catalog.ts';
import type { ChatSegment, LiveEmote } from './types.ts';

/** Upper bound on emotes considered for one event. */
export const MAX_EMOTES_PER_EVENT = 64;

/** Longest image URL that will be accepted. */
export const MAX_EMOTE_URL_LENGTH = 2048;

type NormalizedEmote = {
  id: string;
  shortcode: string;
  imageUrl?: string;
};

/**
 * `true` only for absolute HTTPS URLs. Rejects `javascript:`, `data:`,
 * `file:`, `http:`, and anything unparseable, so untrusted LIVE metadata can
 * never introduce a privileged or plaintext image source.
 */
export function isSafeEmoteImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (!url || url.length > MAX_EMOTE_URL_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.hostname.length > 0;
}

/** Normalizes a `[...]` token, or `undefined` when it is not a valid shape. */
function normalizeShortcode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.trim();
  if (token.length < 3 || token[0] !== '[' || token[token.length - 1] !== ']') return undefined;
  const inner = token.slice(1, -1);
  if (!inner || inner.length > MAX_EMOTE_TOKEN_LENGTH) return undefined;
  return token;
}

/**
 * Validates and indexes the event's emotes. Invalid entries are dropped, the
 * count is bounded, and unsafe image URLs are discarded rather than rejected
 * wholesale so a bad URL only costs the image, not the emote.
 */
export function normalizeEmotes(
  emotes: readonly LiveEmote[] | undefined,
): Map<string, NormalizedEmote> {
  const byToken = new Map<string, NormalizedEmote>();
  if (!emotes?.length) return byToken;
  let accepted = 0;
  for (const emote of emotes) {
    if (accepted >= MAX_EMOTES_PER_EVENT) break;
    if (!emote || typeof emote.id !== 'string') continue;
    const id = emote.id.trim();
    if (!id || id.length > MAX_EMOTE_TOKEN_LENGTH) continue;
    const shortcode = normalizeShortcode(emote.shortcode) ?? `[${id}]`;
    const imageUrl = isSafeEmoteImageUrl(emote.imageUrl) ? emote.imageUrl.trim() : undefined;
    const entry: NormalizedEmote = { id, shortcode, imageUrl };
    const key = shortcode.slice(1, -1).toLowerCase();
    if (!byToken.has(key)) byToken.set(key, entry);
    accepted += 1;
  }
  return byToken;
}

function lookupEmote(
  inner: string,
  metadata: Map<string, NormalizedEmote>,
): NormalizedEmote | undefined {
  if (!inner || inner.length > MAX_EMOTE_TOKEN_LENGTH) return undefined;
  const key = inner.toLowerCase();
  const fromEvent = metadata.get(key);
  if (fromEvent) return fromEvent;
  const fromCatalog = catalogEmoteById(key);
  if (!fromCatalog) return undefined;
  return { id: fromCatalog.id, shortcode: fromCatalog.shortcode, imageUrl: fromCatalog.imageUrl };
}

/**
 * Splits a comment into text and emote segments. Unknown bracketed text
 * (`[debug]`, `[1,2,3]`) stays literal text, and adjacent text runs are
 * coalesced so the renderer does not create extra nodes.
 */
export function resolveChatSegments(
  comment: string,
  emotes?: readonly LiveEmote[],
): ChatSegment[] {
  if (!comment) return [];
  const metadata = normalizeEmotes(emotes);
  const segments: ChatSegment[] = [];
  let buffer = '';
  let index = 0;

  const flush = (): void => {
    if (buffer) {
      segments.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };

  while (index < comment.length) {
    const open = comment.indexOf('[', index);
    if (open === -1) {
      buffer += comment.slice(index);
      break;
    }
    buffer += comment.slice(index, open);
    const close = comment.indexOf(']', open + 1);
    if (close === -1) {
      buffer += comment.slice(open);
      break;
    }
    const token = comment.slice(open, close + 1);
    const match = lookupEmote(comment.slice(open + 1, close), metadata);
    if (match) {
      flush();
      segments.push({
        type: 'emote',
        id: match.id,
        shortcode: match.shortcode,
        imageUrl: match.imageUrl,
        fallbackText: token,
      });
    } else {
      buffer += token;
    }
    index = close + 1;
  }
  flush();
  return segments;
}

/**
 * Flattens segments back to text for `title`/`aria-label`/search. Emotes
 * contribute their `fallbackText`, so the flattened form always contains the
 * original comment.
 */
export function segmentsToPlainText(segments: readonly ChatSegment[]): string {
  let out = '';
  for (const segment of segments) {
    out += segment.type === 'text' ? segment.value : segment.fallbackText;
  }
  return out;
}

/** `true` when at least one segment carries a usable image. */
export function hasRenderableEmote(segments: readonly ChatSegment[]): boolean {
  return segments.some((segment) => segment.type === 'emote' && Boolean(segment.imageUrl));
}
