import { beforeEach, describe, expect, test } from 'bun:test';

import {
  clearEmoteImageFailures,
  emoteImageFailureCount,
  hasEmoteImageFailed,
  markEmoteImageFailed,
} from './emote-images.ts';

beforeEach(() => clearEmoteImageFailures());

describe('emote image failure cache', () => {
  test('remembers a failed URL so it is never requested twice', () => {
    const url = 'https://cdn.example.com/a.webp';
    expect(hasEmoteImageFailed(url)).toBe(false);
    markEmoteImageFailed(url);
    expect(hasEmoteImageFailed(url)).toBe(true);
  });

  test('is idempotent', () => {
    markEmoteImageFailed('https://cdn.example.com/a.webp');
    markEmoteImageFailed('https://cdn.example.com/a.webp');
    expect(emoteImageFailureCount()).toBe(1);
  });

  test('evicts oldest entries so the set stays bounded', () => {
    for (let index = 0; index < 300; index += 1) {
      markEmoteImageFailed(`https://cdn.example.com/${index}.webp`);
    }
    expect(emoteImageFailureCount()).toBeLessThanOrEqual(256);
    // The newest entries survive; the oldest were evicted.
    expect(hasEmoteImageFailed('https://cdn.example.com/299.webp')).toBe(true);
    expect(hasEmoteImageFailed('https://cdn.example.com/0.webp')).toBe(false);
  });

  test('clear drops every remembered failure', () => {
    markEmoteImageFailed('https://cdn.example.com/a.webp');
    clearEmoteImageFailures();
    expect(emoteImageFailureCount()).toBe(0);
    expect(hasEmoteImageFailed('https://cdn.example.com/a.webp')).toBe(false);
  });
});
