<script lang="tsx">
import { onUnmounted, ref } from 'vue';
import { t, type Locale } from '../i18n.ts';
import type { DisplayEvent, UserCardUser } from '../types.ts';
import { defineVueComponent } from '../vue/component.ts';
import { IconBolt, IconClose } from './icons.vue';
import { UserAvatar } from './user-avatar.vue';
import { ChatRichText } from './chat-rich-text.vue';
import { formatEventTime, localizedEventText } from '../features/event-text.ts';

type UserCardProps = {
  user: UserCardUser;
  locale: Locale;
  imagesEnabled?: boolean;
  messages?: DisplayEvent[];
  onSelectMessage?: (event: DisplayEvent) => void;
  onClose: () => void;
  /**
   * When false the card is embedded in a host panel (the shared feed aside)
   * that owns dismissal: no outside/ESC listeners and no close button.
   */
  dismissable?: boolean;
};

function formatStamp(locale: Locale, value: number): string {
  return new Date(value).toLocaleString(locale === 'es' ? 'es-ES' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Closable profile card for a feed user. Closes via the X button,
 * Escape, or a press outside the card. Stats come from the leaderboard
 * when the viewer is tracked; the retained live feed provides recent messages.
 */
export const UserCard = defineVueComponent<UserCardProps>(
  ['user', 'locale', 'imagesEnabled', 'messages', 'onSelectMessage', 'onClose', 'dismissable'],
  (props) => {
    const cardRef = ref<HTMLElement | null>(null);
    const dismissable = (): boolean => props.dismissable !== false;

    const onPointerDown = (event: PointerEvent): void => {
      if (!dismissable()) return;
      const card = cardRef.value;
      if (card && !card.contains(event.target as Node)) props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!dismissable()) return;
      if (event.key === 'Escape') props.onClose();
    };

    if (dismissable()) {
      document.addEventListener('pointerdown', onPointerDown, true);
      window.addEventListener('keydown', onKeyDown);
      onUnmounted(() => {
        document.removeEventListener('pointerdown', onPointerDown, true);
        window.removeEventListener('keydown', onKeyDown);
      });
    }

    return () => {
      const { user, locale, imagesEnabled = true, messages = [] } = props;
      const cleanHandle = user.uniqueId.replace(/^@+/, '');
      const displayName =
        user.nickname && user.nickname !== cleanHandle ? user.nickname : `@${cleanHandle}`;
      const level = user.level ?? 1;
      const tracked =
        typeof user.points === 'number' ||
        typeof user.totalChats === 'number' ||
        typeof user.totalCoins === 'number' ||
        typeof user.totalLikes === 'number' ||
        typeof user.totalShares === 'number';
      const stats: Array<{ key: string; value: number }> = [];
      if (typeof user.points === 'number') stats.push({ key: t(locale, 'points'), value: user.points });
      if (typeof user.totalChats === 'number') stats.push({ key: t(locale, 'totalChats'), value: user.totalChats });
      if (typeof user.totalCoins === 'number') stats.push({ key: t(locale, 'totalCoins'), value: user.totalCoins });
      if (typeof user.totalLikes === 'number') stats.push({ key: t(locale, 'statsLikes'), value: user.totalLikes });
      if (typeof user.totalShares === 'number') stats.push({ key: t(locale, 'userCardShares'), value: user.totalShares });

      return (
        <div ref={cardRef} class="tt-user-card" role="dialog" aria-label={displayName}>
          <div class="tt-user-card__head">
            <UserAvatar
              uniqueId={cleanHandle}
              nickname={user.nickname}
              avatarUrl={imagesEnabled ? user.avatarUrl : undefined}
              imgClass="tt-user-card__avatar"
              fallbackClass="tt-user-card__avatar fallback"
            />
            <div class="tt-user-card__identity">
              <span class="tt-user-card__name">{displayName}</span>
              <span class="tt-user-card__handle">@{cleanHandle}</span>
            </div>
            <span class="tt-badge-level" title={`Level ${level}`}>
              <span class="tt-badge-icon">
                <IconBolt />
              </span>
              <span class="tt-badge-text">{t(locale, 'levelBadge', { level })}</span>
            </span>
            {dismissable() ? (
              <button
                type="button"
                class="tt-user-card__close"
                aria-label={t(locale, 'dialogClose')}
                onClick={props.onClose}
              >
                <IconClose size={14} />
              </button>
            ) : null}
          </div>

          {user.isSubscriber ? (
            <span class="tt-user-card__sub">{t(locale, 'userCardSubscriber')}</span>
          ) : null}

          {tracked ? (
            <div class="tt-user-card__stats">
              {stats.map((stat) => (
                <div key={stat.key} class="tt-user-card__stat">
                  <span class="tt-user-card__stat-value">{stat.value.toLocaleString()}</span>
                  <span class="tt-user-card__stat-label">{stat.key}</span>
                </div>
              ))}
            </div>
          ) : (
            <p class="tt-user-card__empty">{t(locale, 'userCardNoStats')}</p>
          )}

          <section class="tt-user-card__history" aria-label={t(locale, 'userCardRecentMessages')}>
            <div class="tt-user-card__history-head">
              <h3 class="tt-user-card__history-title">{t(locale, 'userCardRecentMessages')}</h3>
              <span class="tt-user-card__history-count">{messages.length}</span>
            </div>
            {messages.length > 0 ? (
              <ol class="tt-user-card__messages">
                {messages.map((event) => {
                  const text = localizedEventText(event, locale);
                  const richText = (event.emotes?.length ?? 0) > 0 || text.includes('[');
                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        class="tt-user-card__message"
                        title={text}
                        aria-label={`${t(locale, 'openEventDetails', { user: displayName })}: ${text}`}
                        onClick={() => props.onSelectMessage?.(event)}
                      >
                        <span class="tt-user-card__message-text">
                          {richText ? (
                            <ChatRichText text={text} emotes={event.emotes} imagesEnabled={imagesEnabled} />
                          ) : (
                            text
                          )}
                        </span>
                        <time
                          class="tt-user-card__message-time"
                          datetime={new Date(event.receivedAt).toISOString()}
                        >
                          {formatEventTime(locale, event.receivedAt)}
                        </time>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p class="tt-user-card__history-empty">{t(locale, 'userCardNoMessages')}</p>
            )}
          </section>

          <footer class="tt-user-card__foot">
            {typeof user.firstSeen === 'number' ? (
              <span>{t(locale, 'userCardFirstSeen', { time: formatStamp(locale, user.firstSeen) })}</span>
            ) : null}
            {typeof user.lastSeen === 'number' ? (
              <span>{t(locale, 'userCardLastSeen', { time: formatStamp(locale, user.lastSeen) })}</span>
            ) : null}
          </footer>
        </div>
      );
    };
  },
);

export default UserCard;
</script>
