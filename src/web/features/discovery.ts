import { ref, shallowRef } from 'vue';

import type { ControlClient } from '../platform/control-client.ts';
import { ControlCallError, errorMessage } from '../platform/control-client.ts';
import type { LiveChannel } from '../types.ts';

/** One row from the read-only `live.channels` browse. */
export interface LiveChannelsResult {
  rooms: LiveChannel[];
  nextOffset?: number;
  fetchedAt: number;
  source: string;
}

export type DiscoveryStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  | 'auth_required'
  | 'rate_limited';

export interface DiscoveryCallbacks {
  translate: (key: string) => string;
  /** Currently connected creator, excluded from random selection. */
  currentCreator: () => string;
}

/** Reuse a page for a moment instead of hammering TikTok on every reopen. */
const CACHE_TTL_MS = 20_000;
/** Results older than this are stale enough to require a refresh before
 *  connecting, because rooms end between search and click. */
const STALE_AFTER_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 350;
const PAGE_LIMIT = 20;
const MAX_PAGES = 4;

function dedupeRooms(rooms: LiveChannel[]): LiveChannel[] {
  const seen = new Set<string>();
  const result: LiveChannel[] = [];
  for (const room of rooms) {
    const key = room.roomId || room.uniqueId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(room);
  }
  return result;
}

/**
 * Read-only LIVE browsing. Opt-in: nothing touches the network until the
 * explorer is opened. Requests are debounced, cached briefly, revision-
 * fenced so a slow response cannot overwrite a newer one, and bounded by
 * a page cap. Discovery never connects on its own.
 */
export function useDiscovery(control: ControlClient, callbacks: DiscoveryCallbacks) {
  const open = ref(false);
  const keyword = ref('');
  const rooms = shallowRef<LiveChannel[]>([]);
  const status = ref<DiscoveryStatus>('idle');
  const error = ref('');
  const nextOffset = ref<number | null>(null);
  const fetchedAt = ref(0);
  const randomCandidate = ref<LiveChannel | null>(null);
  const pages = ref(0);

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let revision = 0;
  let lastQuery = '';
  let lastFetchedAt = 0;
  let inFlightKey: string | null = null;
  let disposed = false;

  const classify = (failure: unknown): DiscoveryStatus => {
    if (failure instanceof ControlCallError) {
      if (failure.code === 'unauthenticated') return 'auth_required';
      if (failure.code === 'rate_limited') return 'rate_limited';
    }
    return 'error';
  };

  const fetchPage = async (query: string, offset: number, append: boolean): Promise<void> => {
    const key = `${query}::${offset}`;
    if (inFlightKey === key) return;
    const requestRevision = ++revision;
    inFlightKey = key;
    status.value = 'loading';
    error.value = '';
    randomCandidate.value = null;
    if (!append) {
      rooms.value = [];
      nextOffset.value = null;
      pages.value = 0;
    }
    try {
      const result = await control.call<LiveChannelsResult>('live.channels', {
        keyword: query || undefined,
        offset: offset || undefined,
        limit: PAGE_LIMIT,
      });
      if (disposed || requestRevision !== revision) return;
      rooms.value = dedupeRooms(append ? [...rooms.value, ...result.rooms] : result.rooms);
      const hasMore = result.rooms.length > 0
        && typeof result.nextOffset === 'number'
        && pages.value + 1 < MAX_PAGES;
      nextOffset.value = hasMore ? (result.nextOffset as number) : null;
      if (hasMore) pages.value += 1;
      fetchedAt.value = result.fetchedAt || Date.now();
      lastFetchedAt = Date.now();
      lastQuery = query;
      status.value = 'ready';
    } catch (failure) {
      if (disposed || requestRevision !== revision) return;
      status.value = classify(failure);
      error.value = errorMessage(failure);
      if (!append) {
        rooms.value = [];
        nextOffset.value = null;
      }
    } finally {
      if (inFlightKey === key) inFlightKey = null;
    }
  };

  const runSearch = (query: string, force = false): void => {
    const normalized = query.trim();
    // Reuse a warm page; an explicit refresh always goes to the network.
    if (
      !force
      && normalized === lastQuery
      && rooms.value.length > 0
      && Date.now() - lastFetchedAt < CACHE_TTL_MS
    ) {
      status.value = 'ready';
      return;
    }
    void fetchPage(normalized, 0, false);
  };

  const setKeyword = (value: string): void => {
    keyword.value = value;
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = null;
      runSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const toggle = (): void => {
    open.value = !open.value;
    if (open.value) runSearch(keyword.value);
  };
  const setOpen = (value: boolean): void => {
    open.value = value;
    if (value) runSearch(keyword.value);
  };
  const refresh = (): void => runSearch(keyword.value, true);
  const loadMore = (): void => {
    const offset = nextOffset.value;
    if (offset === null) return;
    void fetchPage(lastQuery, offset, true);
  };

  /** True when the freshest page is old enough that a room may have ended. */
  const isStale = (): boolean => lastFetchedAt === 0 || Date.now() - lastFetchedAt > STALE_AFTER_MS;

  /** Uniformly samples one eligible room. Never claims to sample all of
   *  TikTok LIVE; it only randomizes over the results already fetched. */
  const chooseRandom = (): LiveChannel | null => {
    const current = callbacks.currentCreator().replace(/^@/, '').toLowerCase();
    const eligible = rooms.value.filter((room) => room.uniqueId.toLowerCase() !== current);
    const pool = eligible.length > 0 ? eligible : rooms.value;
    if (pool.length === 0) return null;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index] ?? null;
  };

  const pickRandom = (): LiveChannel | null => {
    const candidate = chooseRandom();
    randomCandidate.value = candidate;
    if (!candidate) error.value = callbacks.translate('exploreNoMatches');
    return candidate;
  };
  const clearRandom = (): void => {
    randomCandidate.value = null;
  };
  const markStale = (): void => {
    error.value = callbacks.translate('exploreStale');
  };

  const dispose = (): void => {
    disposed = true;
    revision += 1;
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = null;
  };

  return {
    open,
    keyword,
    rooms,
    status,
    error,
    randomCandidate,
    hasMore: () => nextOffset.value !== null,
    fetchedAt,
    toggle,
    setOpen,
    setKeyword,
    refresh,
    loadMore,
    isStale,
    markStale,
    pickRandom,
    clearRandom,
    dispose,
  };
}
