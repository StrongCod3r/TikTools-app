import { describe, expect, test } from 'bun:test';

import { eventKindLabelKey, formatEventStamp, localizedEventText } from './event-text.ts';
import type { DisplayEvent } from '../types.ts';

function event(overrides: Partial<DisplayEvent>): DisplayEvent {
  return {
    kind: 'chat',
    author: 'flor',
    text: 'hello',
    id: 1,
    receivedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('localizedEventText', () => {
  test('uses raw text when the event carries no i18n key', () => {
    expect(localizedEventText(event({ text: 'hola' }), 'en')).toBe('hola');
  });

  test('renders a gift from its params', () => {
    const gift = event({
      kind: 'gift',
      text: 'sent a gift',
      i18nKey: 'giftSent',
      i18nParams: { count: 3, giftName: 'Rose', diamonds: 5 },
    });
    expect(localizedEventText(gift, 'en')).toBe('sent 3× Rose (5)');
    expect(localizedEventText(gift, 'es')).toBe('envió 3× Rose (5)');
  });

  test('singular and plural likes render differently', () => {
    const one = event({ kind: 'like', i18nKey: 'likeSent', i18nParams: { count: 1 } });
    const many = event({ kind: 'like', i18nKey: 'likeSent', i18nParams: { count: 25 } });
    expect(localizedEventText(one, 'en')).toBe('sent 1 like');
    expect(localizedEventText(many, 'en')).toBe('sent 25 likes');
  });

  test('chat prefers the comment param over raw text', () => {
    const chat = event({ text: 'raw', i18nKey: 'chatMessage', i18nParams: { comment: 'hola!' } });
    expect(localizedEventText(chat, 'en')).toBe('hola!');
  });
});

describe('eventKindLabelKey', () => {
  test('maps every kind to a dedicated key', () => {
    expect(eventKindLabelKey('chat')).toBe('kindChat');
    expect(eventKindLabelKey('gift')).toBe('kindGift');
    expect(eventKindLabelKey('like')).toBe('kindLike');
    expect(eventKindLabelKey('member')).toBe('kindMember');
    expect(eventKindLabelKey('social')).toBe('kindSocial');
  });
});

describe('formatEventStamp', () => {
  test('is deterministic for a fixed timestamp', () => {
    expect(formatEventStamp('en', 1_700_000_000_000)).toContain('2023');
    expect(formatEventStamp('es', 1_700_000_000_000)).toContain('2023');
  });
});
