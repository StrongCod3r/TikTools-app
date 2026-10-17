<script lang="tsx">
import { defineVueComponent } from '../vue/component.ts';
import type { DisplayEvent } from '../types.ts';
import { t, type Locale } from '../i18n.ts';
import { avatarFallbackColor } from '../features/avatar-color.ts';
import { formatEventTime, localizedEventText } from '../features/event-text.ts';
import { IconGift, IconHeart, IconUsers } from './icons.vue';
import { UserAvatar } from './user-avatar.vue';

export type EventAuthor = {
  uniqueId: string;
  nickname?: string;
  avatarUrl?: string;
};

type EventCardProps = {
  event: DisplayEvent;
  imagesEnabled?: boolean;
  locale?: Locale;
  /** Highlights the row and marks it `aria-current` in the feed list. */
  selected?: boolean;
  /** Selects this event in the shared contextual panel. */
  onSelect?: (event: DisplayEvent) => void;
  /** Opens the event author's profile in the shared contextual panel. */
  onAuthorClick?: (user: EventAuthor) => void;
};

/**
 * One compact feed row. Only the fields needed to scan the stream are
 * visible (avatar, name, a kind glyph, content, timestamp); level, points,
 * gift cost, ids, and payload details live in the contextual panel so the
 * row stays badge-free. The avatar and the author name open the author's
 * profile; the content control selects the event. All three are sibling
 * buttons — no interactive element is nested inside another.
 */
function renderEventCard({
  event,
  locale = 'en',
  imagesEnabled = true,
  selected = false,
  onSelect,
  onAuthorClick,
}: EventCardProps) {
  const cleanHandle = event.author.replace(/^@+/, '');
  const openAuthor = (): void => {
    onAuthorClick?.({
      uniqueId: cleanHandle,
      nickname: event.nickname,
      avatarUrl: event.avatarUrl,
    });
  };

  const displayName =
    event.nickname && event.nickname !== cleanHandle ? event.nickname : `@${cleanHandle}`;

  const text = localizedEventText(event, locale);
  const timeLabel = formatEventTime(locale, event.receivedAt);

  const giftImage =
    event.kind === 'gift' && imagesEnabled && event.giftDetails?.imageUrl ? (
      <img
        class="tt-gift-img"
        src={event.giftDetails.imageUrl}
        alt={event.giftDetails.name}
        loading="lazy"
        referrerpolicy="no-referrer"
        decoding="async"
        onError={(e) => {
          const img = e.currentTarget as HTMLImageElement;
          console.warn('[gift-img-error]', event.giftDetails?.name, img.src.slice(0, 80));
          img.style.display = 'none';
          const fallback = img.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = 'inline-flex';
        }}
      />
    ) : null;

  return (
    <div
      class={`tiktok-chat-row ${event.kind}${selected ? ' is-selected' : ''}`}
      role="listitem"
      aria-current={selected ? 'true' : undefined}
    >
      <button
        type="button"
        class="tt-user-chip"
        title={`@${cleanHandle}`}
        aria-label={t(locale, 'openProfileFor', { user: `@${cleanHandle}` })}
        onClick={openAuthor}
      >
        <UserAvatar
          uniqueId={cleanHandle}
          nickname={event.nickname}
          avatarUrl={imagesEnabled ? event.avatarUrl : undefined}
          fallbackStyle={{ background: avatarFallbackColor(cleanHandle) }}
        />
      </button>

      <button
        type="button"
        class="tt-author tt-author-link"
        title={`@${cleanHandle}`}
        onClick={openAuthor}
      >
        {displayName}
      </button>

      <button
        type="button"
        class="tt-row-content"
        title={text}
        aria-label={t(locale, 'openEventDetails', { user: displayName })}
        onClick={() => onSelect?.(event)}
      >
        {event.kind === 'gift' ? (
          <>
            {giftImage}
            <span
              class="tt-gift-icon"
              style={{ display: giftImage ? 'none' : 'inline-flex' }}
              title={event.giftDetails?.name || 'Gift'}
            >
              <IconGift />
            </span>
          </>
        ) : null}
        {event.kind === 'like' ? (
          <span class="tt-kind-icon">
            <IconHeart />
          </span>
        ) : null}
        {event.kind === 'member' || event.kind === 'social' ? (
          <span class="tt-kind-icon">
            <IconUsers />
          </span>
        ) : null}
        <span class={`tt-text tt-${event.kind}-text`}>{text}</span>
      </button>

      <time class="tt-timestamp" datetime={new Date(event.receivedAt).toISOString()}>
        {timeLabel}
      </time>
    </div>
  );
}

// Stateful components skip updates when their immutable event and other
// props are unchanged, even as the parent appends new feed entries.
export const EventCard = defineVueComponent<EventCardProps>(
  ['event', 'locale', 'imagesEnabled', 'selected', 'onSelect', 'onAuthorClick'],
  (props) => () => renderEventCard(props),
);

export default EventCard;
</script>
