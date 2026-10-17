<script lang="tsx">
import { t, type Locale } from '../i18n.ts';
import type { DisplayEvent, FeedAsideState, TopViewerPayload, UserCardUser, ViewerRecord } from '../types.ts';
import { defineVueComponent } from '../vue/component.ts';
import { FeedEventDetails } from './FeedEventDetails.vue';
import { IconClose } from './icons.vue';
import { TopViewersRibbon } from './top-viewers.vue';
import type { EventAuthor } from './event-card.vue';
import { UserCard } from './user-card.vue';

type FeedAsideProps = {
  locale: Locale;
  imagesEnabled?: boolean;
  state: FeedAsideState;
  /** Retained events from the current LIVE session. */
  events?: DisplayEvent[];
  /** Selected event, resolved by the view from its scoped id. */
  event?: DisplayEvent | null;
  /** Selected user, enriched by the view from the leaderboard. */
  user?: UserCardUser | null;
  topViewers?: TopViewerPayload[];
  leaderboard?: ViewerRecord[];
  liveViewers?: number;
  onClose: () => void;
  onShowViewers: () => void;
  onShowDetails: () => void;
  onShowProfile: () => void;
  onOpenUser: (user: EventAuthor) => void;
  onSelectMessage: (event: DisplayEvent) => void;
};

const PROFILE_MESSAGE_HISTORY_LIMIT = 20;

function normalizeHandle(value: string): string {
  return value.replace(/^@+/, '').trim().toLowerCase();
}

/**
 * One shared contextual panel for the feed: current viewers, the selected
 * event's details, or the selected user's profile. It replaces the old
 * floating user-card popover, so nothing overlaps the stream, and it is a
 * single component that does not remount when new messages arrive.
 */
function renderFeedAside({
  locale,
  imagesEnabled = true,
  state,
  events = [],
  event = null,
  user = null,
  topViewers = [],
  leaderboard = [],
  liveViewers = 0,
  onClose,
  onShowViewers,
  onShowDetails,
  onShowProfile,
  onOpenUser,
  onSelectMessage,
}: FeedAsideProps) {
  const open = state.kind !== 'closed';
  const hasEvent = event !== null;
  const hasUser = user !== null || hasEvent;
  const selectedHandle = state.kind === 'user' && user ? normalizeHandle(user.uniqueId) : '';
  const recentMessages = state.kind === 'user' && user
    ? events
        .filter((entry) => entry.kind === 'chat' && normalizeHandle(entry.author) === selectedHandle)
        .slice(-PROFILE_MESSAGE_HISTORY_LIMIT)
        .reverse()
    : [];

  const tabs: Array<{ key: 'viewers' | 'event' | 'user'; label: string; disabled: boolean; onSelect: () => void }> = [
    { key: 'viewers', label: t(locale, 'contextViewers'), disabled: false, onSelect: onShowViewers },
    { key: 'event', label: t(locale, 'contextDetails'), disabled: !hasEvent, onSelect: onShowDetails },
    { key: 'user', label: t(locale, 'contextProfile'), disabled: !hasUser, onSelect: onShowProfile },
  ];

  return (
    <>
      {open ? (
        <button
          type="button"
          class="feed-aside-backdrop"
          tabindex={-1}
          aria-hidden="true"
          onClick={onClose}
        />
      ) : null}
      <aside
        class={`feed-aside${open ? ' is-open' : ''}`}
        aria-label={t(locale, 'contextPanel')}
        aria-hidden={open ? undefined : 'true'}
      >
      <div class="feed-aside__head">
        {open ? (
          <>
            <div class="feed-aside__tabs" role="tablist" aria-label={t(locale, 'contextPanel')}>
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  class={`feed-aside__tab${state.kind === tab.key ? ' is-active' : ''}`}
                  aria-selected={state.kind === tab.key}
                  disabled={tab.disabled}
                  onClick={tab.onSelect}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              class="feed-aside__close"
              aria-label={t(locale, 'contextClose')}
              onClick={onClose}
            >
              <IconClose size={15} />
            </button>
          </>
        ) : (
          <button
            type="button"
            class="feed-aside__open"
            aria-label={t(locale, 'contextOpen')}
            aria-expanded="false"
            onClick={onShowViewers}
          >
            <span class="feed-aside__open-label">{t(locale, 'contextPanel')}</span>
          </button>
        )}
      </div>

      {open ? (
        <div class="feed-aside__body">
          {state.kind === 'viewers' ? (
            <TopViewersRibbon
              locale={locale}
              imagesEnabled={imagesEnabled}
              topViewers={topViewers}
              leaderboard={leaderboard}
              liveViewers={liveViewers}
              onSelect={onOpenUser}
            />
          ) : null}
          {state.kind === 'event' ? (
            hasEvent ? (
              <FeedEventDetails
                event={event}
                locale={locale}
                imagesEnabled={imagesEnabled}
                onOpenUser={onOpenUser}
              />
            ) : (
              <p class="feed-aside__empty">{t(locale, 'contextEmptyEvent')}</p>
            )
          ) : null}
          {state.kind === 'user' ? (
            user ? (
              <UserCard
                user={user}
                locale={locale}
                imagesEnabled={imagesEnabled}
                messages={recentMessages}
                dismissable={false}
                onClose={onClose}
                onSelectMessage={onSelectMessage}
              />
            ) : (
              <p class="feed-aside__empty">{t(locale, 'contextEmptyUser')}</p>
            )
          ) : null}
        </div>
      ) : null}
      </aside>
    </>
  );
}

export const FeedAside = defineVueComponent<FeedAsideProps>(
  [
    'locale',
    'imagesEnabled',
    'state',
    'events',
    'event',
    'user',
    'topViewers',
    'leaderboard',
    'liveViewers',
    'onClose',
    'onShowViewers',
    'onShowDetails',
    'onShowProfile',
    'onOpenUser',
    'onSelectMessage',
  ],
  (props) => () => renderFeedAside(props),
);

export default FeedAside;
</script>
