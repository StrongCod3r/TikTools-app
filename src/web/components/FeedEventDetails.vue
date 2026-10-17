<script lang="tsx">
import { t, type Locale } from '../i18n.ts';
import type { DisplayEvent } from '../types.ts';
import { avatarFallbackColor } from '../features/avatar-color.ts';
import { eventKindLabelKey, formatEventStamp, localizedEventText } from '../features/event-text.ts';
import { defineVueComponent } from '../vue/component.ts';
import { Button } from './ui/Button.vue';
import { UserAvatar } from './user-avatar.vue';
import type { EventAuthor } from './event-card.vue';

type FeedEventDetailsProps = {
  event: DisplayEvent;
  locale: Locale;
  imagesEnabled?: boolean;
  onOpenUser: (user: EventAuthor) => void;
};

/** Formats a finite number, or N/A when the field was never tracked. */
function numberOrNa(locale: Locale, value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : t(locale, 'valueNotAvailable');
}

function formatNumber(locale: Locale, value: number): string {
  return value.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US');
}

/**
 * Full, read-only detail for one feed event. Everything the compact row
 * hides — kind, level, points, gift cost, ids, exact timestamp — is shown
 * here, and fields the backend never carried render as N/A rather than a
 * fabricated zero.
 */
function renderFeedEventDetails({ event, locale, imagesEnabled = true, onOpenUser }: FeedEventDetailsProps) {
  const cleanHandle = event.author.replace(/^@+/, '');
  const displayName =
    event.nickname && event.nickname !== cleanHandle ? event.nickname : `@${cleanHandle}`;
  const text = localizedEventText(event, locale);

  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: 'kind', label: t(locale, 'detailKind'), value: t(locale, eventKindLabelKey(event.kind)) },
  ];
  if (event.kind === 'gift') {
    rows.push({
      key: 'giftCount',
      label: t(locale, 'detailGiftCount'),
      value: numberOrNa(locale, event.giftDetails?.count),
    });
    rows.push({
      key: 'giftDiamonds',
      label: t(locale, 'detailGiftDiamonds'),
      value: numberOrNa(locale, event.giftDetails?.diamonds),
    });
  }
  if (event.kind === 'like') {
    rows.push({
      key: 'likeCount',
      label: t(locale, 'detailLikeCount'),
      value: numberOrNa(locale, event.likeCount),
    });
  }
  if (typeof event.level === 'number') {
    rows.push({ key: 'level', label: t(locale, 'detailLevel'), value: formatNumber(locale, event.level) });
  }
  rows.push({
    key: 'points',
    label: t(locale, 'detailPoints'),
    value: typeof event.pointsDelta === 'number' ? `+${formatNumber(locale, event.pointsDelta)}` : t(locale, 'valueNotAvailable'),
  });
  rows.push({ key: 'time', label: t(locale, 'detailTime'), value: formatEventStamp(locale, event.receivedAt) });
  if (event.msgId) {
    rows.push({ key: 'msgId', label: t(locale, 'detailMessageId'), value: event.msgId });
  }

  return (
    <div class="feed-details">
      <div class="feed-details__head">
        <button
          type="button"
          class="tt-user-chip"
          onClick={() => onOpenUser({ uniqueId: cleanHandle, nickname: event.nickname, avatarUrl: event.avatarUrl })}
          aria-label={t(locale, 'openProfileFor', { user: `@${cleanHandle}` })}
        >
          <UserAvatar
            uniqueId={cleanHandle}
            nickname={event.nickname}
            avatarUrl={imagesEnabled ? event.avatarUrl : undefined}
            imgClass="feed-details__avatar"
            fallbackClass="feed-details__avatar fallback"
            fallbackStyle={{ background: avatarFallbackColor(cleanHandle) }}
          />
        </button>
        <div class="feed-details__identity">
          <span class="feed-details__name">{displayName}</span>
          <span class="feed-details__handle">@{cleanHandle}</span>
        </div>
      </div>

      <p class="feed-details__text">{text}</p>

      <dl class="feed-details__rows">
        {rows.map((row) => (
          <div key={row.key} class="feed-details__row">
            <dt>{row.label}</dt>
            <dd title={row.value}>{row.value}</dd>
          </div>
        ))}
      </dl>

      <Button
        size="sm"
        variant="soft"
        block
        onClick={() => onOpenUser({ uniqueId: cleanHandle, nickname: event.nickname, avatarUrl: event.avatarUrl })}
      >
        {t(locale, 'contextProfile')}
      </Button>
    </div>
  );
}

export const FeedEventDetails = defineVueComponent<FeedEventDetailsProps>(
  ['event', 'locale', 'imagesEnabled', 'onOpenUser'],
  (props) => () => renderFeedEventDetails(props),
);

export default FeedEventDetails;
</script>
