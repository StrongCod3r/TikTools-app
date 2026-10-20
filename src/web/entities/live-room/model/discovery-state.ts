import { ref, shallowRef } from 'vue';
import type { ControlClient } from '@/shared/api/control-client.ts';
import { ControlCallError, errorMessage } from '@/shared/api/control-client.ts';
import type { LiveChannel } from '@/types.ts';
import { fetchLiveChannels } from '../api/live-rooms-api.ts';
import { chooseRandomRoom, dedupeRooms } from '../lib/rooms.ts';

export type DiscoveryStatus = 'idle' | 'loading' | 'ready' | 'error' | 'auth_required' | 'rate_limited';

export type DiscoveryNotice = 'stale' | 'noMatches' | null;

const CACHE_TTL_MS = 20_000;
const STALE_AFTER_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 350;
const PAGE_LIMIT = 20;
const MAX_PAGES = 4;

function classify(failure: unknown): DiscoveryStatus {
  if (failure instanceof ControlCallError) {
    if (failure.code === 'unauthenticated') return 'auth_required';
    if (failure.code === 'rate_limited') return 'rate_limited';
  }
  return 'error';
}

export function createDiscoveryState(control: ControlClient) {
  const open = ref(false);
  const keyword = ref('');
  const rooms = shallowRef<LiveChannel[]>([]);
  const status = ref<DiscoveryStatus>('idle');
  const error = ref('');
  const notice = ref<DiscoveryNotice>(null);
  const nextOffset = ref<number | null>(null);
  const randomCandidate = ref<LiveChannel | null>(null);

  let pages = 0;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let revision = 0;
  let lastQuery = '';
  let lastFetchedAt = 0;
  let inFlightKey: string | null = null;
  let disposed = false;

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
      pages = 0;
    }
    try {
      const result = await fetchLiveChannels(control, { keyword: query, offset, limit: PAGE_LIMIT });
      if (disposed || requestRevision !== revision) return;
      rooms.value = dedupeRooms(append ? [...rooms.value, ...result.rooms] : result.rooms);
      const hasMore = result.rooms.length > 0 && typeof result.nextOffset === 'number' && pages + 1 < MAX_PAGES;
      nextOffset.value = hasMore ? result.nextOffset! : null;
      if (hasMore) pages += 1;
      lastFetchedAt = Date.now();
      lastQuery = query;
      notice.value = null;
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
    const cached = normalized === lastQuery && rooms.value.length > 0 && Date.now() - lastFetchedAt < CACHE_TTL_MS;
    if (!force && cached) {
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

  const setOpen = (value: boolean): void => {
    open.value = value;
    if (value) runSearch(keyword.value);
  };

  const refresh = (): void => runSearch(keyword.value, true);

  const loadMore = (): void => {
    if (nextOffset.value !== null) void fetchPage(lastQuery, nextOffset.value, true);
  };

  const isStale = (): boolean => lastFetchedAt === 0 || Date.now() - lastFetchedAt > STALE_AFTER_MS;

  const markStale = (): void => {
    notice.value = 'stale';
  };

  const pickRandom = (currentCreator: string): LiveChannel | null => {
    const candidate = chooseRandomRoom(rooms.value, currentCreator);
    randomCandidate.value = candidate;
    notice.value = candidate ? null : 'noMatches';
    return candidate;
  };

  const clearRandom = (): void => {
    randomCandidate.value = null;
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
    notice,
    nextOffset,
    randomCandidate,
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
