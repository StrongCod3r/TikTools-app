import { ref, watch } from 'vue';

import type { GiftCatalogEntry, UiEvent } from '../../shared/messages.ts';
import type { ControlClient } from '../platform/control-client.ts';
import { errorMessage } from '../platform/control-client.ts';
import type { DisplayEvent, EventFilter, TopViewerPayload } from '../types.ts';
import { debounce, loadViewState, saveViewState } from './view-state.ts';

export interface LiveCallbacks {
  /** Optional chat observer (auto-speech left the main frontend). */
  onChat?: (
    author: string,
    text: string,
    points: number | undefined,
    isSubscriber: boolean | undefined,
  ) => void;
  systemAuthor: () => string;
}

export interface GiftCatalogResult {
  gifts: GiftCatalogEntry[];
}

/** Live feed: events, room stats, gift catalog, and scroll state. */

/**
 * Replay guard. TikTok re-sends recent messages as history when the
 * connection drops and rejoins, so the same event can arrive twice.
 * Live events carry the backend's `msgId` (stable per TikTok message);
 * synthetic events without one fall back to a content checksum with a
 * short time window. Both caches are bounded, and intentionally survive
 * `resetEvents` — a reconnect replay must not re-trigger events the
 * feed already showed before the disconnect.
 */
const DEDUP_WINDOW_MS = 5000;
const DEDUP_CACHE_LIMIT = 256;
const seenMsgIds = new Map<string, number>();
const seenChecksums = new Map<string, number>();

function eventChecksum(event: UiEvent): string {
  const gift = event.giftDetails;
  return [
    event.kind,
    event.author,
    event.text,
    event.likeCount ?? '',
    gift ? `${gift.name}:${gift.count}:${gift.diamonds}` : '',
  ].join('|');
}

/** Records the event identity and reports whether it was already seen. */
function isDuplicateEvent(event: UiEvent, now: number): boolean {
  const msgId = event.msgId;
  if (msgId !== undefined) {
    if (seenMsgIds.has(msgId)) return true;
    seenMsgIds.set(msgId, now);
    if (seenMsgIds.size > DEDUP_CACHE_LIMIT) {
      const oldest = seenMsgIds.keys().next().value;
      if (oldest !== undefined) seenMsgIds.delete(oldest);
    }
    return false;
  }
  const checksum = eventChecksum(event);
  const firstSeen = seenChecksums.get(checksum);
  if (firstSeen !== undefined && now - firstSeen < DEDUP_WINDOW_MS) return true;
  seenChecksums.set(checksum, now);
  if (seenChecksums.size > DEDUP_CACHE_LIMIT) {
    const oldest = seenChecksums.keys().next().value;
    if (oldest !== undefined) seenChecksums.delete(oldest);
  }
  return false;
}

export function useLive(control: ControlClient, callbacks: LiveCallbacks) {
  // Feed options survive reloads through the window-state
  // blob; the scroll position restores once the stream has
  // content tall enough to hold it.
  const savedFeed = loadViewState().feed;
  const events = ref<DisplayEvent[]>([]);
  const filter = ref<EventFilter>(savedFeed?.filter ?? 'all');
  const searchQuery = ref(savedFeed?.searchQuery ?? '');
  const topViewers = ref<TopViewerPayload[]>([]);
  const liveViewers = ref(0);
  const giftCatalog = ref<GiftCatalogEntry[]>([]);
  const autoScroll = ref(savedFeed?.autoScroll ?? true);
  const unreadCount = ref(0);
  /** UI-side shed counter: staged events dropped while the tab is
   *  backgrounded or frames stall. Backend delivery is unaffected. */
  const droppedUiEvents = ref(0);
  const nextEventId = ref(0);
  const streamContainerRef = ref<HTMLDivElement | null>(null);
  let restoreScrollTop = savedFeed?.scrollTop;
  let scrollSaveHandler: (() => void) | null = null;
  const unsubscribers: Array<() => void> = [];
  // Topic handlers keep their exact control-client overload types; only
  // the unsubscribers are collected so dispose() can release them.

  // Bounded nonreactive staging buffer: inbound messages accumulate here
  // without touching reactivity, and one scheduled frame moves them into
  // the reactive feed in a single assignment. A burst of N messages per
  // frame costs one render, never N.
  const MAX_VISIBLE_FEED = 300;
  const MAX_STAGED_EVENTS = 900;
  let staged: DisplayEvent[] = [];
  let flushQueued = false;
  let flushFrame = 0;
  let scrollFrame = 0;
  let disposed = false;

  // Frame scheduler with a synchronous fallback: unit tests and
  // non-browser hosts have no `requestAnimationFrame`, and the feed must
  // still update there (without batching, which needs real frames).
  const scheduleFrame = (callback: () => void): number => {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
    callback();
    return 0;
  };
  const cancelFrame = (id: number): void => {
    if (id !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  };

  const stageEvent = (event: DisplayEvent): void => {
    staged.push(event);
    if (staged.length > MAX_STAGED_EVENTS) {
      // Shed the oldest staged events first: the feed shows the latest
      // 300, so stale backlog is the cheapest thing to lose. Counted for
      // visibility; backend/points state is unaffected.
      const shed = staged.length - MAX_STAGED_EVENTS;
      staged.splice(0, shed);
      droppedUiEvents.value += shed;
    }
    if (!flushQueued && !disposed) {
      flushQueued = true;
      flushFrame = scheduleFrame(flushStaged);
    }
  };

  const flushStaged = (): void => {
    flushQueued = false;
    flushFrame = 0;
    if (disposed || staged.length === 0) return;
    const batch = staged;
    staged = [];
    const now = Date.now();
    for (const stagedEvent of batch) stagedEvent.receivedAt = now;
    events.value = [...events.value, ...batch].slice(-MAX_VISIBLE_FEED);
    if (!autoScroll.value) unreadCount.value += batch.length;
    for (const stagedEvent of batch) {
      if (stagedEvent.kind === 'chat' && stagedEvent.text) {
        callbacks.onChat?.(
          stagedEvent.author,
          stagedEvent.text,
          stagedEvent.points,
          stagedEvent.isSubscriber,
        );
      }
    }
    if (autoScroll.value) queueScroll();
  };

  const resetEvents = (): void => {
    nextEventId.value = 0;
    staged = [];
    events.value = [];
    unreadCount.value = 0;
    droppedUiEvents.value = 0;
    topViewers.value = [];
    liveViewers.value = 0;
  };

  const applyScroll = (): void => {
    scrollFrame = 0;
    // Never mutate scroll while paused: one coalesced write per frame,
    // only when pinned to the bottom.
    if (disposed || !autoScroll.value) return;
    const container = streamContainerRef.value;
    if (container) container.scrollTop = container.scrollHeight;
  };

  const queueScroll = (): void => {
    if (scrollFrame !== 0 || disposed) return;
    scrollFrame = scheduleFrame(applyScroll);
  };

  const scrollToBottom = (): void => {
    queueScroll();
  };

  const dispose = (): void => {
    disposed = true;
    cancelFrame(flushFrame);
    cancelFrame(scrollFrame);
    flushFrame = 0;
    scrollFrame = 0;
    flushQueued = false;
    staged = [];
    while (unsubscribers.length > 0) unsubscribers.pop()?.();
    const container = streamContainerRef.value;
    if (container && scrollSaveHandler) {
      container.removeEventListener('scroll', scrollSaveHandler);
      scrollSaveHandler = null;
    }
  };

  const pushFeedEvent = (event: UiEvent): void => {
    // Drop replays before they reach the feed: a reconnect
    // replay must not re-render, count as unread, or re-fire
    // the chat observer.
    if (isDuplicateEvent(event, Date.now())) return;
    stageEvent({ ...event, id: nextEventId.value++, receivedAt: Date.now() });
  };

  // Live feed state arrives only via authoritative domain topics; the
  // legacy `live-event` / `room-stats` / `gift-catalog` pushes are no
  // longer subscribed (backend keeps them solely for compatibility).
  unsubscribers.push(control.onTopic<{ event: UiEvent }>('live.ui-event', (data) => {
    pushFeedEvent(data.event);
  }));
  unsubscribers.push(control.onTopic<{ viewers: number; totalUsers: number; topViewers: TopViewerPayload[] }>(
    'room.stats',
    (data) => {
      topViewers.value = data.topViewers;
      liveViewers.value = data.viewers;
    },
  ));
  unsubscribers.push(control.onTopic<{ gifts: GiftCatalogEntry[] }>('gifts.catalog', (data) => {
    giftCatalog.value = data.gifts;
  }));
  unsubscribers.push(control.onTopic<{ phase: string; message: string }>('live.error', (data) => {
    stageEvent({
      kind: 'member' as const,
      author: callbacks.systemAuthor(),
      text: data.message,
      id: nextEventId.value++,
      receivedAt: Date.now(),
    });
  }));

  const refresh = async (): Promise<void> => {
    try {
      const result = await control.call<GiftCatalogResult>('gifts.list', {});
      giftCatalog.value = result.gifts;
    } catch (failure) {
      console.warn(`gifts.list failed: ${errorMessage(failure)}`);
    }
  };

  const handleToggleAutoScroll = (): void => {
    const nextState = !autoScroll.value;
    autoScroll.value = nextState;
    if (nextState) {
      unreadCount.value = 0;
      scrollToBottom();
    }
  };

  const setFilter = (value: EventFilter): void => {
    filter.value = value;
  };
  const setSearchQuery = (value: string): void => {
    searchQuery.value = value;
  };
  /** Persists the feed options plus the current scroll offset. */
  const saveFeedState = (): void => {
    saveViewState('feed', {
      filter: filter.value,
      searchQuery: searchQuery.value,
      autoScroll: autoScroll.value,
      scrollTop: streamContainerRef.value?.scrollTop ?? 0,
    });
  };
  const saveFeedStateDebounced = debounce(saveFeedState);
  watch([filter, searchQuery, autoScroll], saveFeedStateDebounced);
  /** Applies the restored scroll offset once content is tall enough. */
  const applySavedScrollTop = (): void => {
    const container = streamContainerRef.value;
    const top = restoreScrollTop;
    if (!container || top === undefined || top <= 0 || autoScroll.value) return;
    if (container.scrollHeight < top) return;
    container.scrollTop = top;
    restoreScrollTop = undefined;
  };
  watch(events, applySavedScrollTop);
  const setStreamContainerRef = (element: Element | null): void => {
    const previous = streamContainerRef.value;
    if (previous && scrollSaveHandler) {
      previous.removeEventListener('scroll', scrollSaveHandler);
      scrollSaveHandler = null;
    }
    streamContainerRef.value = element instanceof HTMLDivElement ? element : null;
    const container = streamContainerRef.value;
    if (!container) return;
    // Restore the position the user left when auto-scroll is
    // off; with auto-scroll on, the controller's watcher keeps
    // the stream pinned to the bottom instead.
    scheduleFrame(applySavedScrollTop);
    scrollSaveHandler = debounce(saveFeedState);
    container.addEventListener('scroll', scrollSaveHandler);
  };

  return {
    events,
    filter,
    searchQuery,
    topViewers,
    liveViewers,
    giftCatalog,
    autoScroll,
    unreadCount,
    droppedUiEvents,
    streamContainerRef,
    resetEvents,
    scrollToBottom,
    handleToggleAutoScroll,
    setFilter,
    setSearchQuery,
    setStreamContainerRef,
    refresh,
    dispose,
  };
}
