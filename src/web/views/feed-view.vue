<script lang="tsx">
import { ref } from 'vue';
import type { VNode, VNodeRef } from 'vue';

import { EventCard } from '../components/event-card.vue';
import { IconArrowDown, IconBolt, IconChat, IconChevronLeft, IconChevronRight, IconDot, IconGift, IconHeart, IconPause, IconRadio, IconTrash, IconUsers } from '../components/icons.vue';
import { Button } from '../components/ui/Button.vue';
import { SearchInput } from '../components/ui/TextInput.vue';
import { Tooltip } from '../components/ui/Tooltip.vue';
import { UserCard } from '../components/user-card.vue';
import { defineVueComponent } from '../vue/component.ts';
import { t, type Locale } from '../i18n.ts';
import type { DisplayEvent, EventFilter, TopViewerPayload, UserCardUser, ViewerRecord } from '../types.ts';
import { TopViewersRibbon } from '../components/top-viewers.vue';

type FeedViewProps = {
  locale: Locale;
  events: DisplayEvent[];
  imagesEnabled?: boolean;
  renderLimit?: number;
  leaderboard?: ViewerRecord[];
  topViewers?: TopViewerPayload[];
  liveViewers?: number;
  filter: EventFilter;
  searchQuery: string;
  autoScroll: boolean;
  unreadCount: number;
  droppedUiEvents?: number;
  onFilterChange: (f: EventFilter) => void;
  onSearchChange: (q: string) => void;
  onToggleAutoScroll: () => void;
  onClearFeed: () => void;
  streamContainerRef: (el: Element | null) => void;
};

/** Identity fields every feed section can offer to the user card. */
type UserSource = { uniqueId: string; nickname?: string; avatarUrl?: string };

const VIEWERS_COLLAPSED_KEY = 'tiktok-live-viewers-collapsed';

/** Shared filter memo across renders: re-renders from unrelated state
 * reuse the last scan instead of re-filtering up to 300 events. */
const filterCache = new WeakMap<
  DisplayEvent[],
  { key: string; result: DisplayEvent[] }
>;

function readViewersCollapsed(): boolean {
  try {
    return localStorage.getItem(VIEWERS_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function renderFeedView({
  locale,
  events,
  imagesEnabled = true,
  renderLimit = 100,
  leaderboard = [],
  topViewers = [],
  liveViewers = 0,
  filter,
  searchQuery,
  autoScroll,
  unreadCount,
  droppedUiEvents = 0,
  onFilterChange,
  onSearchChange,
  onToggleAutoScroll,
  onClearFeed,
  streamContainerRef,
  viewersCollapsed,
  onToggleViewers,
  selectedUser,
  onOpenUser,
  onCloseUser,
}: FeedViewProps & {
  viewersCollapsed: boolean;
  onToggleViewers: () => void;
  selectedUser: UserCardUser | null;
  onOpenUser: (source: UserSource) => void;
  onCloseUser: () => void;
}) {
  const filterButtons: Array<{ key: EventFilter; tooltip: string; icon: VNode }> = [
    { key: 'all', tooltip: t(locale, 'filterAll'), icon: <IconBolt /> },
    { key: 'chat', tooltip: t(locale, 'filterChats'), icon: <IconChat /> },
    { key: 'gift', tooltip: t(locale, 'filterGifts'), icon: <IconGift /> },
    { key: 'like', tooltip: t(locale, 'filterLikes'), icon: <IconHeart /> },
    { key: 'social', tooltip: t(locale, 'filterSocial'), icon: <IconUsers /> },
  ];

  // Memoized filtering: re-renders from unrelated state (locale,
  // leaderboard, connection) reuse the last scan instead of re-filtering
  // up to 300 events. Keyed weakly on the events array, which the batched
  // feed replaces at most once per frame.
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filterCacheKey = `${filter}::${normalizedQuery}`;
  let filteredEvents: typeof events;
  const cached = filterCache.get(events);
  if (cached && cached.key === filterCacheKey) {
    filteredEvents = cached.result;
  } else {
    filteredEvents = events.filter((ev) => {
      if (filter !== 'all') {
        if (filter === 'chat' && ev.kind !== 'chat') return false;
        if (filter === 'gift' && ev.kind !== 'gift') return false;
        if (filter === 'like' && ev.kind !== 'like') return false;
        if (filter === 'social' && ev.kind !== 'social' && ev.kind !== 'member') return false;
      }
      if (normalizedQuery) {
        const q = normalizedQuery;
        return ev.author.toLowerCase().includes(q) || ev.text.toLowerCase().includes(q);
      }
      return true;
    });
    filterCache.set(events, { key: filterCacheKey, result: filteredEvents });
  }

  // Keep the complete bounded buffer available for paused reading, search,
  // and filtering. The pinned stream paints only the newest cards.
  const windowed = autoScroll && filter === 'all' && !normalizedQuery && filteredEvents.length > renderLimit;
  const renderedEvents = windowed ? filteredEvents.slice(-renderLimit) : filteredEvents;

  const viewersTotal = liveViewers > 0
    ? liveViewers
    : topViewers.length > 0
      ? topViewers.length
      : leaderboard.length;

  return (
    <main class="feed-pane">
      <div class="feed-toolbar">
        <div class="filter-icon-group" role="tablist" aria-label={t(locale, 'filterAll')}>
          {filterButtons.map((btn) => (
            <Tooltip key={btn.key} text={btn.tooltip} position="bottom">
              <button
                type="button"
                class={`filter-icon-btn ${filter === btn.key ? 'active' : ''}`}
                aria-label={btn.tooltip}
                aria-pressed={filter === btn.key}
                onClick={() => onFilterChange(btn.key)}
              >
                {btn.icon}
              </button>
            </Tooltip>
          ))}
        </div>

        <SearchInput value={searchQuery} onValueChange={onSearchChange} placeholder={t(locale, 'searchEvents')} />
      </div>

      <div class="feed-layout">
        <section class="feed-main">
          <div class="feed-stream" ref={streamContainerRef as VNodeRef}>
            {filteredEvents.length === 0 ? (
              <div class="feed-empty">
                <div class="empty-icon empty-icon--illustration">
                  <IconRadio size={28} />
                </div>
                <p>{t(locale, 'messagesEmpty')}</p>
              </div>
            ) : (
              renderedEvents.map((ev) => (
                <EventCard key={ev.id} event={ev} locale={locale} imagesEnabled={imagesEnabled} onAuthorClick={onOpenUser} />
              ))
            )}
          </div>

          <footer class="feed-footer-info">
            <span>
              {t(locale, filteredEvents.length === 1 ? 'messageCountOne' : 'messageCountMany', {
                count: filteredEvents.length,
              })}
              {windowed ? (
                <span class="feed-window-hint" title={t(locale, 'feedWindowedHint')}>
                  {' '}({t(locale, 'feedWindowed', { count: renderedEvents.length })})
                </span>
              ) : null}
              {(droppedUiEvents ?? 0) > 0 ? (
                <span
                  class="feed-dropped-hint"
                  title={t(locale, 'uiEventsDropped', { count: droppedUiEvents ?? 0 })}
                >
                  {' '}
                  ({t(locale, 'uiEventsDropped', { count: droppedUiEvents ?? 0 })})
                </span>
              ) : null}
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Button
                size="sm"
                variant="soft"
                tooltip={autoScroll ? t(locale, 'autoScrollOn') : t(locale, 'autoScrollPaused')}
                icon={autoScroll ? <span style={{ color: 'var(--tt-green)', display: 'inline-flex' }}><IconDot /></span> : <IconPause />}
                iconOnly
                onClick={onToggleAutoScroll}
              />
              <Button size="sm" variant="soft" tooltip={t(locale, 'clearFeed')} icon={<IconTrash />} iconOnly onClick={onClearFeed} />
            </div>
          </footer>
        </section>

        <aside class={`feed-side${viewersCollapsed ? ' is-collapsed' : ''}`} aria-label={t(locale, 'topContributors')}>
          <div class="feed-side__head">
            {viewersCollapsed ? (
              <Tooltip text={t(locale, 'expandViewers')} position="left">
                <button
                  type="button"
                  class="feed-side__toggle"
                  aria-label={t(locale, 'expandViewers')}
                  aria-expanded="false"
                  onClick={onToggleViewers}
                >
                  <IconChevronLeft size={15} />
                </button>
              </Tooltip>
            ) : (
              <>
                <span class="feed-side__title">
                  {t(locale, 'viewersCount')}
                  <span class="feed-side__count">{viewersTotal}</span>
                </span>
                <Tooltip text={t(locale, 'collapseViewers')} position="left">
                  <button
                    type="button"
                    class="feed-side__toggle"
                    aria-label={t(locale, 'collapseViewers')}
                    aria-expanded="true"
                    onClick={onToggleViewers}
                  >
                    <IconChevronRight size={15} />
                  </button>
                </Tooltip>
              </>
            )}
          </div>
          {viewersCollapsed ? null : (
            <div class="feed-side__body">
              <TopViewersRibbon
                locale={locale}
                imagesEnabled={imagesEnabled}
                topViewers={topViewers}
                leaderboard={leaderboard}
                liveViewers={liveViewers}
                onSelect={onOpenUser}
              />
            </div>
          )}
        </aside>
      </div>

      {selectedUser ? (
        <div class="tt-user-card-overlay">
          <UserCard user={selectedUser} locale={locale} onClose={onCloseUser} />
        </div>
      ) : null}

      {!autoScroll && unreadCount > 0 ? (
        <div class="feed-floating-bar">
          <Button variant="primary" size="sm" icon={<IconArrowDown />} onClick={onToggleAutoScroll}>
            {t(locale, 'scrollToBottom', { count: unreadCount })}
          </Button>
        </div>
      ) : null}
    </main>
  );
}

export const FeedView = defineVueComponent<FeedViewProps>(
  [
    'locale',
    'events',
    'imagesEnabled',
    'renderLimit',
    'leaderboard',
    'topViewers',
    'liveViewers',
    'filter',
    'searchQuery',
    'autoScroll',
    'unreadCount',
    'droppedUiEvents',
    'onFilterChange',
    'onSearchChange',
    'onToggleAutoScroll',
    'onClearFeed',
    'streamContainerRef',
  ],
  (props) => {
    const viewersCollapsed = ref(readViewersCollapsed());
    const selectedUser = ref<UserCardUser | null>(null);
    const onToggleViewers = (): void => {
      viewersCollapsed.value = !viewersCollapsed.value;
      try {
        localStorage.setItem(VIEWERS_COLLAPSED_KEY, viewersCollapsed.value ? '1' : '0');
      } catch {
        // Collapse preference is best-effort when storage is unavailable.
      }
    };
    // Feed sections only carry identity fields; the leaderboard
    // fills in the engagement stats for tracked viewers.
    const onOpenUser = (source: UserSource): void => {
      const record = props.leaderboard?.find((entry) => entry.uniqueId === source.uniqueId);
      selectedUser.value = {
        uniqueId: source.uniqueId,
        nickname: source.nickname ?? record?.nickname,
        avatarUrl: source.avatarUrl ?? record?.avatarUrl,
        points: record?.points,
        level: record?.level,
        isSubscriber: record?.isSubscriber,
        totalChats: record?.totalChats,
        totalCoins: record?.totalCoins,
        totalLikes: record?.totalLikes,
        totalShares: record?.totalShares,
        firstSeen: record?.firstSeen,
        lastSeen: record?.lastSeen,
      };
    };
    const onCloseUser = (): void => {
      selectedUser.value = null;
    };
    return () =>
      renderFeedView({
        ...props,
        viewersCollapsed: viewersCollapsed.value,
        onToggleViewers,
        selectedUser: selectedUser.value,
        onOpenUser,
        onCloseUser,
      });
  },
);

export default FeedView;
</script>
