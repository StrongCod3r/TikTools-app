<script lang="tsx">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { VNode, VNodeRef } from 'vue';

import { EventCard, type EventAuthor } from '../components/event-card.vue';
import { FeedAside } from '../components/FeedAside.vue';
import { IconArrowDown, IconBolt, IconChat, IconDot, IconGift, IconHeart, IconPause, IconRadio, IconTrash, IconUsers } from '../components/icons.vue';
import { Button } from '../components/ui/Button.vue';
import { SearchInput } from '../components/ui/TextInput.vue';
import { Tooltip } from '../components/ui/Tooltip.vue';
import { defineVueComponent } from '../vue/component.ts';
import { loadViewState, saveViewState } from '../features/view-state.ts';
import { t, type Locale } from '../i18n.ts';
import type { DisplayEvent, EventFilter, FeedAsideState, TopViewerPayload, UserCardUser, ViewerRecord } from '../types.ts';

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
  /** Identity of the current session; a change clears a stale selection. */
  sessionKey?: string;
  onFilterChange: (f: EventFilter) => void;
  onSearchChange: (q: string) => void;
  onToggleAutoScroll: () => void;
  onClearFeed: () => void;
  streamContainerRef: (el: Element | null) => void;
};

/** Shared filter memo across renders: re-renders from unrelated state
 * reuse the last scan instead of re-filtering up to 300 events. */
const filterCache = new WeakMap<
  DisplayEvent[],
  { key: string; result: DisplayEvent[] }
>;

/** Fills a viewer's engagement stats from the leaderboard when tracked,
 * leaving untracked stats absent so the card shows N/A, never a fake zero. */
function enrichUser(source: EventAuthor, leaderboard: ViewerRecord[]): UserCardUser {
  const record = leaderboard.find((entry) => entry.uniqueId === source.uniqueId);
  return {
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
  asideState,
  selectedEvent,
  selectedUser,
  onSelectEvent,
  onOpenUser,
  onShowViewers,
  onShowDetails,
  onShowProfile,
  onCloseAside,
}: FeedViewProps & {
  asideState: FeedAsideState;
  selectedEvent: DisplayEvent | null;
  selectedUser: UserCardUser | null;
  onSelectEvent: (event: DisplayEvent) => void;
  onOpenUser: (source: EventAuthor) => void;
  onShowViewers: () => void;
  onShowDetails: () => void;
  onShowProfile: () => void;
  onCloseAside: () => void;
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
          <div class="feed-stream" role="list" ref={streamContainerRef as VNodeRef}>
            {filteredEvents.length === 0 ? (
              <div class="feed-empty">
                <div class="empty-icon empty-icon--illustration">
                  <IconRadio size={28} />
                </div>
                <p>{t(locale, 'messagesEmpty')}</p>
              </div>
            ) : (
              renderedEvents.map((ev) => (
                <EventCard
                  key={ev.id}
                  event={ev}
                  locale={locale}
                  imagesEnabled={imagesEnabled}
                  selected={asideState.kind === 'event' && asideState.eventId === ev.id}
                  onSelect={onSelectEvent}
                  onAuthorClick={onOpenUser}
                />
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

        <FeedAside
          locale={locale}
          imagesEnabled={imagesEnabled}
          state={asideState}
          event={selectedEvent}
          user={selectedUser}
          topViewers={topViewers}
          leaderboard={leaderboard}
          liveViewers={liveViewers}
          onClose={onCloseAside}
          onShowViewers={onShowViewers}
          onShowDetails={onShowDetails}
          onShowProfile={onShowProfile}
          onOpenUser={onOpenUser}
        />
      </div>

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
    'sessionKey',
    'onFilterChange',
    'onSearchChange',
    'onToggleAutoScroll',
    'onClearFeed',
    'streamContainerRef',
  ],
  (props) => {
    const savedAside = loadViewState().aside;
    const asideState = ref<FeedAsideState>(
      savedAside?.open === false ? { kind: 'closed' } : { kind: 'viewers' },
    );
    const selectedEventId = ref<number | null>(null);
    const selectedUserSource = ref<EventAuthor | null>(null);

    const sessionId = (): string => props.sessionKey ?? '';
    const selectedEvent = computed<DisplayEvent | null>(() => {
      const state = asideState.value;
      if (state.kind !== 'event') return null;
      return props.events.find((event) => event.id === state.eventId) ?? null;
    });
    const selectedUser = computed<UserCardUser | null>(() => {
      const source = selectedUserSource.value;
      return source ? enrichUser(source, props.leaderboard ?? []) : null;
    });

    const selectEvent = (event: DisplayEvent): void => {
      selectedEventId.value = event.id;
      asideState.value = { kind: 'event', sessionId: sessionId(), eventId: event.id };
    };
    const openUser = (source: EventAuthor): void => {
      selectedUserSource.value = source;
      asideState.value = { kind: 'user', sessionId: sessionId(), uniqueId: source.uniqueId };
    };
    const showViewers = (): void => {
      asideState.value = { kind: 'viewers' };
    };
    const showDetails = (): void => {
      if (selectedEventId.value !== null) {
        asideState.value = { kind: 'event', sessionId: sessionId(), eventId: selectedEventId.value };
      }
    };
    const showProfile = (): void => {
      const source = selectedUserSource.value;
      if (source) {
        asideState.value = { kind: 'user', sessionId: sessionId(), uniqueId: source.uniqueId };
      }
    };
    const closeAside = (): void => {
      asideState.value = { kind: 'closed' };
    };

    // Persist only the open/closed preference (never event or user data),
    // and restore focus to whatever opened the panel when it closes.
    let restoreFocus: HTMLElement | null = null;
    watch(asideState, (state, previous) => {
      if (previous?.kind === 'closed' && state.kind !== 'closed') {
        restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      if (state.kind === 'closed' && restoreFocus) {
        restoreFocus.focus?.();
        restoreFocus = null;
      }
      saveViewState('aside', { open: state.kind !== 'closed' });
    });

    // A creator switch is a new session: drop the stale selection so it can
    // never resolve against the new feed, but keep the panel's open state.
    watch(
      () => props.sessionKey,
      () => {
        selectedEventId.value = null;
        selectedUserSource.value = null;
        asideState.value = asideState.value.kind === 'closed' ? { kind: 'closed' } : { kind: 'viewers' };
      },
    );

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && asideState.value.kind !== 'closed') closeAside();
    };
    window.addEventListener('keydown', onKeyDown);
    onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

    return () =>
      renderFeedView({
        ...props,
        asideState: asideState.value,
        selectedEvent: selectedEvent.value,
        selectedUser: selectedUser.value,
        onSelectEvent: selectEvent,
        onOpenUser: openUser,
        onShowViewers: showViewers,
        onShowDetails: showDetails,
        onShowProfile: showProfile,
        onCloseAside: closeAside,
      });
  },
);

export default FeedView;
</script>
