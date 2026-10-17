import { t, type Locale } from '../i18n.ts';
import type { DisplayEvent } from '../types.ts';

/**
 * Renders the human-readable body of a feed event from its i18n key and
 * params, falling back to the raw text when the event carries no key.
 * Shared by the compact row and the contextual details panel so both
 * surfaces can never disagree about what an event says.
 */
export function localizedEventText(event: DisplayEvent, locale: Locale): string {
  const key = event.i18nKey;
  const p = event.i18nParams ?? {};
  if (!key) return event.text;

  switch (key) {
    case 'giftSent':
      return t(locale, 'giftSent', {
        count: p.count ?? event.giftDetails?.count ?? 1,
        giftName: p.giftName ?? event.giftDetails?.name ?? 'Gift',
        diamonds: p.diamonds ?? event.giftDetails?.diamonds ?? 1,
      });
    case 'likeSent': {
      const c = Number(p.count ?? event.likeCount ?? 1);
      return c === 1
        ? t(locale, 'likeSentOne', { count: c })
        : t(locale, 'likeSentMany', { count: c });
    }
    case 'joinedLive':
      return t(locale, 'joinedLive');
    case 'followedCreator':
      return t(locale, 'followedCreator');
    case 'sharedLive':
      return t(locale, 'sharedLive');
    case 'chatMessage':
      return String(p.comment ?? event.text);
    default:
      return event.text;
  }
}

/** Translation key naming an event kind, used by the details panel. */
export function eventKindLabelKey(kind: DisplayEvent['kind']): string {
  switch (kind) {
    case 'chat':
      return 'kindChat';
    case 'gift':
      return 'kindGift';
    case 'like':
      return 'kindLike';
    case 'member':
      return 'kindMember';
    default:
      return 'kindSocial';
  }
}

/** Timestamp label. Date and time are kept separate so panels can stack
 *  them while feed rows stay one line. */
export function formatEventTime(locale: Locale, value: number): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

export function formatEventStamp(locale: Locale, value: number): string {
  return new Date(value).toLocaleString(locale === 'es' ? 'es-ES' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
