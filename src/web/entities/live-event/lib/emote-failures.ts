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

export function clearEmoteImageFailures(): void {
  failed.clear();
}

export function emoteImageFailureCount(): number {
  return failed.size;
}
