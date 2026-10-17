/**
 * Bounded memory of emote images that failed to load.
 *
 * A re-rendered row creates a fresh `<img>` element, which would re-request a
 * URL the browser already rejected. Remembering the failure keeps that
 * retry from happening, and the bounded FIFO keeps the set from growing with
 * a long LIVE session. Entries are cheap (a URL string), so the cap is
 * generous relative to how many distinct emotes a room uses.
 */

const MAX_FAILED_EMOTE_URLS = 256;

const failed = new Set<string>();

export function hasEmoteImageFailed(url: string): boolean {
  return failed.has(url);
}

export function markEmoteImageFailed(url: string): void {
  if (failed.has(url)) return;
  if (failed.size >= MAX_FAILED_EMOTE_URLS) {
    const oldest = failed.values().next().value;
    if (oldest !== undefined) failed.delete(oldest);
  }
  failed.add(url);
}

/** Test/teardown hook: drops every remembered failure. */
export function clearEmoteImageFailures(): void {
  failed.clear();
}

export function emoteImageFailureCount(): number {
  return failed.size;
}
