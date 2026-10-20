import { ref, shallowRef, watch } from 'vue';

import type { GiftCatalogEntry, UiEvent } from '../../../../shared/messages.ts';
import type { ControlClient } from '@/shared/api/control-client.ts';
import { errorMessage } from '@/shared/api/control-client.ts';
import type { DisplayEvent, EventFilter, TopViewerPayload } from '@/types.ts';
import { debounce, loadViewState, saveViewState, type DebouncedCallback } from '@/features/view-state.ts';

export interface LiveFeedCallbacks {
  systemAuthor: () => string;
  discontinuityText: () => string;
}

export interface GiftCatalogResult {
  gifts: GiftCatalogEntry[];
}

export interface FeedBackfillResult {
  oldestCursor: number;
  latestCursor: number;
  depth: number;
  gap: boolean;
  truncated: boolean;
  events: Array<{ cursor: number; event: UiEvent }>;
}

const DEDUP_WINDOW_MS = 5000;
const DEDUP_CACHE_LIMIT = 256;
const MESSAGE_ID_MAX_AGE_MS = 10 * 60_000;

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

function isDuplicateEvent(event: UiEvent, now: number, seenMsgIds: Map<string, number>, seenChecksums: Map<string, number>): boolean {
  const msgId = event.msgId;
  if (msgId !== undefined) {
    const seen = seenMsgIds.get(msgId);
    if (seen !== undefined && now - seen < MESSAGE_ID_MAX_AGE_MS) return true;
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

export function createLiveFeedState(control: ControlClient, callbacks: LiveFeedCallbacks) {
  const seenMsgIds = new Map<string, number>();
  const seenChecksums = new Map<string, number>();
  let sessionScope = '';
  const savedFeed = loadViewState().feed;
  const events = shallowRef<DisplayEvent[]>([]);
  const filter = ref<EventFilter>(savedFeed?.filter ?? 'all');
  const imagesEnabled = ref(true);
  const renderLimit = ref(100);
  const searchQuery = ref(savedFeed?.searchQuery ?? '');
  const topViewers = shallowRef<TopViewerPayload[]>([]);
  const liveViewers = ref(0);
  const giftCatalog = shallowRef<GiftCatalogEntry[]>([]);
  const autoScroll = ref(savedFeed?.autoScroll ?? true);
  const unreadCount = ref(0);
    const droppedUiEvents = ref(0);
  const error = ref<string | null>(null);
  let nextEventId = 0;
  const streamContainerRef = ref<HTMLDivElement | null>(null);
  let restoreScrollTop = savedFeed?.scrollTop;
  let scrollSaveHandler: DebouncedCallback | null = null;
  let restoreFrame = 0;
  let restoreTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshRevision = 0;
  const unsubscribers: Array<() => void> = [];

  const MAX_VISIBLE_FEED = 300;
  const MAX_STAGED_EVENTS = 900;
  let staged: DisplayEvent[] = [];
  let flushQueued = false;
  let flushFrame = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollFrame = 0;
  let disposed = false;
  let presentationActive = true;
  let hasPresented = false;
  let commits = 0;
  let received = 0;
  let suspendedAt = 0;
  let lastHostSuspended: number | null = null;
  let lastHostBusDropped: number | null = null;
  let lastDeliverySequence: number | null = null;
    let lastFeedCursor: number | null = null;

  const scheduleFrame = (callback: () => void): number => {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
    callback();
    return 0;
  };
  const cancelFrame = (id: number): void => {
    if (id !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  };

  const stageEvent = (event: DisplayEvent): void => {
    if (disposed) return;
    if (!presentationActive) { droppedUiEvents.value += 1; return; }
    hasPresented = true;
    staged.push(event);
    if (staged.length > MAX_STAGED_EVENTS) {
      const shed = staged.length - MAX_STAGED_EVENTS;
      staged.splice(0, shed);
      droppedUiEvents.value += shed;
    }
    if (!flushQueued && !disposed) {
      flushQueued = true;
      if (typeof requestAnimationFrame === 'function') flushTimer = setTimeout(flushStaged, 100);
      flushFrame = scheduleFrame(flushStaged);
    }
  };

  const flushStaged = (): void => {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    cancelFrame(flushFrame);
    flushQueued = false;
    flushFrame = 0;
    if (disposed || !presentationActive || staged.length === 0) return;
    const batch = staged;
    staged = [];
    const now = Date.now();
    for (const stagedEvent of batch) stagedEvent.receivedAt = now;
    commits += 1;
    events.value = [...events.value, ...batch].slice(-MAX_VISIBLE_FEED);
    if (!autoScroll.value) unreadCount.value += batch.length;
    if (autoScroll.value) queueScroll();
  };

  const resetEvents = (): void => {
    nextEventId = 0;
    staged = [];
    events.value = [];
    unreadCount.value = 0;
    droppedUiEvents.value = 0;
    topViewers.value = [];
    liveViewers.value = 0;
  };

  const applyScroll = (): void => {
    if (scrollTimer !== null) clearTimeout(scrollTimer);
    scrollTimer = null;
    cancelFrame(scrollFrame);
    scrollFrame = 0;
    if (disposed || !presentationActive || !autoScroll.value) return;
    const container = streamContainerRef.value;
    if (container) container.scrollTop = container.scrollHeight;
  };

  const queueScroll = (): void => {
    if (scrollFrame !== 0 || scrollTimer !== null || disposed || !presentationActive) return;
    if (typeof requestAnimationFrame === 'function') scrollTimer = setTimeout(applyScroll, 100);
    scrollFrame = scheduleFrame(applyScroll);
  };

  const scrollToBottom = (): void => {
    queueScroll();
  };

  const dispose = (): void => {
    disposed = true;
    cancelFrame(flushFrame);
    cancelFrame(scrollFrame);
    cancelFrame(restoreFrame);
    if (restoreTimer !== null) clearTimeout(restoreTimer);
    restoreTimer = null;
    if (flushTimer !== null) clearTimeout(flushTimer);
    if (scrollTimer !== null) clearTimeout(scrollTimer);
    flushTimer = scrollTimer = null;
    refreshRevision += 1;
    saveFeedStateDebounced.cancel();
    scrollSaveHandler?.cancel();
    seenMsgIds.clear();
    seenChecksums.clear();
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

  const pushFeedEvent = (event: UiEvent, cursor?: number): void => {
    if (disposed) return;
    received += 1;
    if (!presentationActive) { droppedUiEvents.value += 1; return; }
    if (cursor !== undefined) lastFeedCursor = Math.max(lastFeedCursor ?? 0, cursor);
    if (isDuplicateEvent(event, Date.now(), seenMsgIds, seenChecksums)) return;
    stageEvent({ ...event, id: nextEventId++, receivedAt: Date.now() });
  };

  const insertDiscontinuity = (): void => {
    stageEvent({
      kind: 'member',
      author: callbacks.systemAuthor(),
      text: callbacks.discontinuityText(),
      id: nextEventId++,
      receivedAt: Date.now(),
    });
  };

    const recoverFeed = async (): Promise<void> => {
    const cursor = lastFeedCursor;
    const canCall = typeof (control as { call?: unknown }).call === 'function';
    if (!canCall || cursor === null) {
      insertDiscontinuity();
      return;
    }
    try {
      const result = await control.call<FeedBackfillResult>('ui.feed.backfill', { version: 1, after: cursor });
      if (disposed || !presentationActive) return;
      let recovered = 0;
      const now = Date.now();
      for (const entry of result.events ?? []) {
        if (typeof entry?.event !== 'object' || entry.event === null) continue;
        if (isDuplicateEvent(entry.event, now, seenMsgIds, seenChecksums)) continue;
        stageEvent({ ...entry.event, id: nextEventId++, receivedAt: now });
        recovered += 1;
      }
      if (typeof result.latestCursor === 'number') lastFeedCursor = Math.max(lastFeedCursor ?? 0, result.latestCursor);
      droppedUiEvents.value = Math.max(0, droppedUiEvents.value - recovered);
      if (result.gap || result.truncated) insertDiscontinuity();
    } catch {
      if (!disposed && presentationActive) insertDiscontinuity();
    }
  };

  const setPresentationActive = (active: boolean): void => {
    if (disposed || active === presentationActive) return;
    presentationActive = active;
    if (!active) {
      if (!autoScroll.value && streamContainerRef.value) {
        restoreScrollTop = streamContainerRef.value.scrollTop;
        saveFeedState();
      }
      suspendedAt = droppedUiEvents.value;
      droppedUiEvents.value += staged.length;
      staged = [];
      cancelFrame(flushFrame);
      cancelFrame(scrollFrame);
      cancelFrame(restoreFrame);
      if (restoreTimer !== null) clearTimeout(restoreTimer);
      restoreTimer = null;
      restoreFrame = 0;
      if (flushTimer !== null) clearTimeout(flushTimer);
      if (scrollTimer !== null) clearTimeout(scrollTimer);
      flushTimer = scrollTimer = null;
      flushFrame = scrollFrame = 0;
      flushQueued = false;
    } else if (hasPresented || droppedUiEvents.value > suspendedAt) {
      void recoverFeed();
    }
  };

  unsubscribers.push(control.onTopic<{ feedSuspended: number; feedBusDropped?: number; feedForwarded?: number }>('ui.projection.stats', (data) => {
    if (!Number.isFinite(data.feedSuspended)) return;
    if (lastDeliverySequence === null && typeof data.feedForwarded === 'number') lastDeliverySequence = data.feedForwarded;
    const previous = lastHostSuspended ?? data.feedSuspended;
    droppedUiEvents.value += Math.max(0, data.feedSuspended - previous);
    lastHostSuspended = data.feedSuspended;
    if (typeof data.feedBusDropped === 'number' && Number.isFinite(data.feedBusDropped)) {
      const previousDropped = lastHostBusDropped ?? data.feedBusDropped;
      droppedUiEvents.value += Math.max(0, data.feedBusDropped - previousDropped);
      lastHostBusDropped = data.feedBusDropped;
    }
  }));

  unsubscribers.push(control.onTopic<{ uniqueId?: string; roomId?: string }>('live.connected', (data) => {
    const scope = `${data.uniqueId ?? ''}:${data.roomId ?? ''}`;
    if (scope !== sessionScope) {
      seenMsgIds.clear();
      seenChecksums.clear();
      sessionScope = scope;
      lastFeedCursor = null;
    }
  }));
  unsubscribers.push(control.onTopic<{ event: UiEvent; sequence?: number; cursor?: number }>('live.ui-event', (data) => {
    if (typeof data.sequence === 'number' && Number.isSafeInteger(data.sequence)) {
      if (lastDeliverySequence !== null) droppedUiEvents.value += Math.max(0, data.sequence - lastDeliverySequence - 1);
      lastDeliverySequence = Math.max(lastDeliverySequence ?? 0, data.sequence);
    }
    const cursor = typeof data.cursor === 'number' && Number.isSafeInteger(data.cursor) ? data.cursor : undefined;
    pushFeedEvent(data.event, cursor);
  }));
  unsubscribers.push(control.onTopic<{ viewers: number; totalUsers: number; topViewers: TopViewerPayload[] }>(
    'room.stats',
    (data) => {
      topViewers.value = data.topViewers;
      liveViewers.value = data.viewers;
    },
  ));
  unsubscribers.push(control.onTopic<{ gifts: GiftCatalogEntry[] }>('gifts.catalog', (data) => {
    refreshRevision += 1;
    giftCatalog.value = data.gifts;
  }));
  unsubscribers.push(control.onTopic<{ phase: string; message: string }>('live.error', (data) => {
    stageEvent({
      kind: 'member' as const,
      author: callbacks.systemAuthor(),
      text: data.message,
      id: nextEventId++,
      receivedAt: Date.now(),
    });
  }));

  const refresh = async (): Promise<void> => {
    const revision = ++refreshRevision;
    try {
      const result = await control.call<GiftCatalogResult>('gifts.list', {});
      if (!disposed && revision === refreshRevision) giftCatalog.value = result.gifts;
    } catch (failure) {
      if (!disposed && revision === refreshRevision) error.value = errorMessage(failure);
    }
  };

  const handleToggleAutoScroll = (): void => {
    const nextState = !autoScroll.value;
    autoScroll.value = nextState;
    if (!nextState) {
      cancelFrame(scrollFrame);
      scrollFrame = 0;
      if (scrollTimer !== null) clearTimeout(scrollTimer);
      scrollTimer = null;
    }
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
    const saveFeedState = (): void => {
    saveViewState('feed', {
      filter: filter.value,
      searchQuery: searchQuery.value,
      autoScroll: autoScroll.value,
      scrollTop: streamContainerRef.value?.scrollTop ?? 0,
    });
  };
  const saveFeedStateDebounced = debounce(saveFeedState);
  unsubscribers.push(watch([filter, searchQuery, autoScroll], saveFeedStateDebounced));
    const applySavedScrollTop = (): void => {
    const container = streamContainerRef.value;
    const top = restoreScrollTop;
    if (!container || top === undefined || top <= 0 || autoScroll.value) return;
    if (container.scrollHeight < top) return;
    container.scrollTop = top;
    restoreScrollTop = undefined;
  };
  unsubscribers.push(watch(events, applySavedScrollTop));
  const setStreamContainerRef = (element: Element | null): void => {
    const next = element instanceof HTMLDivElement ? element : null;
    if (streamContainerRef.value === next) return;
    const previous = streamContainerRef.value;
    if (previous && scrollSaveHandler) {
      previous.removeEventListener('scroll', scrollSaveHandler);
      scrollSaveHandler.cancel();
      scrollSaveHandler = null;
    }
    streamContainerRef.value = next;
    const container = streamContainerRef.value;
    if (!container) return;
    cancelFrame(restoreFrame);
    if (restoreTimer !== null) clearTimeout(restoreTimer);
    const restore = (): void => {
      cancelFrame(restoreFrame);
      restoreFrame = 0;
      if (restoreTimer !== null) clearTimeout(restoreTimer);
      restoreTimer = null;
      if (!disposed) applySavedScrollTop();
    };
    if (!autoScroll.value && restoreScrollTop !== undefined && restoreScrollTop > 0) restoreTimer = setTimeout(restore, 100);
    restoreFrame = scheduleFrame(restore);
    scrollSaveHandler = debounce(saveFeedState);
    container.addEventListener('scroll', scrollSaveHandler);
  };

  return {
    diagnostics: () => ({ visible: events.value.length, staged: staged.length, dropped: droppedUiEvents.value, presentationActive, commits, received, cursor: lastFeedCursor, timers: Number(flushTimer !== null) + Number(scrollTimer !== null) + Number(restoreTimer !== null), frames: Number(flushFrame !== 0) + Number(scrollFrame !== 0) + Number(restoreFrame !== 0) }),
    events,
    imagesEnabled,
    renderLimit,
    filter,
    searchQuery,
    topViewers,
    liveViewers,
    giftCatalog,
    autoScroll,
    unreadCount,
    droppedUiEvents,
    error,
    streamContainerRef,
    resetEvents,
    setPresentationActive,
    scrollToBottom,
    handleToggleAutoScroll,
    setFilter,
    setSearchQuery,
    setStreamContainerRef,
    refresh,
    dispose,
  };
}
