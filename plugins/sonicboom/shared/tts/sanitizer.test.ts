import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  EMOTE_CATALOG,
  EMOTE_CATALOG_VERSION,
  MAX_EMOTE_TOKEN_LENGTH,
  emoteById,
  isKnownEmoteId,
} from './emote-catalog.ts';
import {
  collapseTtsWhitespace,
  defaultTtsSanitizerSettings,
  isBlankTtsText,
  isTtsWhitespace,
  isUnwantedInvisible,
  sanitizeTtsText,
  stripKnownEmotes,
  stripUnicodeEmoji,
  type TtsTextSanitizerSettings,
} from './sanitizer.ts';

type SanitizerCase = {
  name: string;
  input: string;
  expected: string;
  override?: Partial<TtsTextSanitizerSettings>;
};

type FixtureFile = {
  version: number;
  catalogVersion: string;
  defaults: TtsTextSanitizerSettings;
  cases: SanitizerCase[];
};

const fixtures: FixtureFile = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'sanitizer-cases.json'), 'utf8'),
) as FixtureFile;

describe('shared sanitizer fixtures (parity contract)', () => {
  test('fixture defaults match the shipped defaults', () => {
    expect(fixtures.defaults).toEqual(defaultTtsSanitizerSettings());
  });

  test('fixture catalog version matches the shipped catalog', () => {
    expect(fixtures.catalogVersion).toBe(EMOTE_CATALOG_VERSION);
  });

  for (const testCase of fixtures.cases) {
    test(testCase.name, () => {
      const settings: TtsTextSanitizerSettings = {
        ...fixtures.defaults,
        ...(testCase.override ?? {}),
      };
      expect(sanitizeTtsText(testCase.input, settings)).toBe(testCase.expected);
    });
  }
});

describe('stripKnownEmotes', () => {
  test('never removes arbitrary bracketed text', () => {
    for (const token of ['[debug]', '[1,2,3]', '[username]', '[]', '[a b]']) {
      expect(stripKnownEmotes(`x ${token} y`, 'remove')).toBe(`x ${token} y`);
    }
  });

  test('removes every occurrence of a known token', () => {
    expect(stripKnownEmotes('[wow][wow][wow]', 'remove')).toBe('');
  });

  test('does not treat a partial token as an emote', () => {
    expect(stripKnownEmotes('x [wow', 'remove')).toBe('x [wow');
    expect(stripKnownEmotes('x wow]', 'remove')).toBe('x wow]');
  });

  test('describe mode keeps surrounding words intact', () => {
    expect(stripKnownEmotes('a[happy]b', 'describe')).toBe('a happy b');
  });

  test('oversized tokens are ignored without scanning forever', () => {
    const token = `[${'x'.repeat(MAX_EMOTE_TOKEN_LENGTH + 1)}]`;
    expect(stripKnownEmotes(token, 'remove')).toBe(token);
  });
});

describe('stripUnicodeEmoji', () => {
  test('keeps the plain text around emoji', () => {
    expect(stripUnicodeEmoji('hi 👋 there')).toBe('hi  there');
  });

  test('keeps text-default pictographs', () => {
    expect(stripUnicodeEmoji('© ® ™ ↔')).toBe('© ® ™ ↔');
  });

  test('keeps regional-indicator flags as a single cluster', () => {
    expect(stripUnicodeEmoji('flag 🇲🇽 here')).toBe('flag  here');
  });

  test('never removes ordinary non-latin scripts', () => {
    expect(stripUnicodeEmoji('こんにちは 세계 مرحبا')).toBe('こんにちは 세계 مرحبا');
  });
});

describe('character predicates', () => {
  test('whitespace table covers the shared set', () => {
    for (const code of [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x3000, 0xfeff]) {
      expect(isTtsWhitespace(code)).toBe(true);
    }
    for (const code of [0x41, 0x200b, 0x200c, 0x200d, 0x1f602]) {
      expect(isTtsWhitespace(code)).toBe(false);
    }
  });

  test('joiners are never treated as unwanted invisibles', () => {
    expect(isUnwantedInvisible(0x200c)).toBe(false);
    expect(isUnwantedInvisible(0x200d)).toBe(false);
    expect(isUnwantedInvisible(0xfe0f)).toBe(false);
    expect(isUnwantedInvisible(0x200b)).toBe(true);
    expect(isUnwantedInvisible(0xfeff)).toBe(true);
    expect(isUnwantedInvisible(0x00ad)).toBe(true);
    expect(isUnwantedInvisible(0x41)).toBe(false);
  });
});

describe('collapseTtsWhitespace and isBlankTtsText', () => {
  test('collapses runs and trims the ends', () => {
    expect(collapseTtsWhitespace('  a \t\n b  ')).toBe('a b');
    expect(collapseTtsWhitespace('   ')).toBe('');
  });

  test('blankness treats whitespace-only as empty', () => {
    expect(isBlankTtsText('')).toBe(true);
    expect(isBlankTtsText(' \t\n ')).toBe(true);
    expect(isBlankTtsText(' a ')).toBe(false);
  });
});

describe('catalog', () => {
  test('ids are unique, lowercase, and bracket-consistent', () => {
    const seen = new Set<string>();
    for (const entry of EMOTE_CATALOG) {
      expect(seen.has(entry.id)).toBe(false);
      seen.add(entry.id);
      expect(entry.id).toBe(entry.id.toLowerCase());
      expect(entry.shortcode).toBe(`[${entry.id}]`);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  test('lookup is case-insensitive and trimmed', () => {
    expect(emoteById('  LAUGHCRY ')).toBeDefined();
    expect(isKnownEmoteId('Happy')).toBe(true);
    expect(isKnownEmoteId('not-an-emote')).toBe(false);
  });
});

describe('sanitizer is a pure function', () => {
  test('does not mutate its settings or input', () => {
    const settings = defaultTtsSanitizerSettings();
    const snapshot = { ...settings };
    const input = 'Hello [laughcry] world 😂';
    sanitizeTtsText(input, settings);
    expect(settings).toEqual(snapshot);
    expect(input).toBe('Hello [laughcry] world 😂');
  });
});
