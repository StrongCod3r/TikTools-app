import { ref, shallowRef } from 'vue';

import type { ControlClient } from '../platform/control-client.ts';
import { errorMessage } from '../platform/control-client.ts';
import type { PointsConfig, ViewerRecord } from '../types.ts';

export const defaultPointsConfig: PointsConfig = {
  currencyName: 'Points',
  pointsPerCoin: 1.0,
  pointsPerCoinEnabled: true,
  pointsPerShare: 3.0,
  pointsPerShareEnabled: true,
  pointsPerChat: 1.0,
  pointsPerChatEnabled: true,
  pointsPerLike: 0.1,
  pointsPerLikeEnabled: true,
  pointsPerFollow: 5.0,
  pointsPerFollowEnabled: true,
  pointsPerJoin: 0.5,
  pointsPerJoinEnabled: false,
  subBonusMultiplier: 0.0,
  pointsPerLevel: 100,
};

export interface LeaderboardResult {
  viewers: ViewerRecord[];
}

export interface PointsChangedData {
  uniqueId: string;
  delta: number;
  totalPoints: number;
  level: number;
}

/** Points config and leaderboard. Awards arrive only via the authoritative
 * `points.changed` domain event; the legacy push is no longer subscribed. */
export function usePoints(control: ControlClient) {
  const pointsConfig = ref<PointsConfig>(defaultPointsConfig);
  // Award patches and host snapshots replace the board; unchanged viewers
  // keep their identity without deep reactive proxies.
  const leaderboard = shallowRef<ViewerRecord[]>([]);
  const unsubscribers: Array<() => void> = [];
  // Handlers keep their exact control-client overload types; only the
  // unsubscribers are collected so dispose() can release them.
  // Memoized identity lookup: chat-rate calls resolve against a cached
  // map rebuilt only when the board array itself is replaced.
  let lookupCache: { board: ViewerRecord[]; map: Map<string, number>; owners: Map<string, string> } | null = null;

  let disposed = false;
  let presentationActive = true;
  let hiddenMiss = false;
  let revision = 0;
  let refreshGeneration = 0;
  let boardSnapshotRevision = 0;
  let configRevision = 0;
  let awardTimer: ReturnType<typeof setTimeout> | null = null;
  // Only loaded viewers are retained: bounded by the top-100 board, rather
  // than the number of distinct chatters. Totals are absolute, never summed.
  const pendingAwards = new Map<string, PointsChangedData & { revision: number }>();
  const refreshAwards = new Map<string, PointsChangedData>();
  let snapshotInFlight = false;
  let viewerIndex = new Map<string, number>();
  const replaceBoard = (board: ViewerRecord[]): void => {
    leaderboard.value = board;
    viewerIndex = new Map(board.map((viewer, index) => [viewer.uniqueId, index]));
  };
  const commitAwards = (): void => {
    awardTimer = null;
    if (disposed || !presentationActive || pendingAwards.size === 0) return;
    const updated = [...leaderboard.value];
    for (const award of pendingAwards.values()) {
      const index = viewerIndex.get(award.uniqueId);
      const current = index === undefined ? undefined : updated[index];
      if (current && index !== undefined) {
        updated[index] = { ...current, points: award.totalPoints, level: award.level, lastSeen: Date.now() };
      }
    }
    pendingAwards.clear();
    replaceBoard(updated.sort((left, right) => right.points - left.points));
  };
  const applyAward = (data: PointsChangedData): boolean => {
    revision += 1;
    if (!viewerIndex.has(data.uniqueId)) return false;
    if (snapshotInFlight) refreshAwards.set(data.uniqueId, data);
    pendingAwards.set(data.uniqueId, { ...data, revision });
    if (lookupCache?.board === leaderboard.value) {
      const key = data.uniqueId.trim().replace(/^@/, '').toLowerCase();
      if (lookupCache.owners.get(key) === data.uniqueId) lookupCache.map.set(key, data.totalPoints);
    }
    if (presentationActive && awardTimer === null) awardTimer = setTimeout(commitAwards, 100);
    return true;
  };

  unsubscribers.push(control.onPush('points-config', (message) => {
    if (message.type !== 'points-config') return;
    configRevision += 1;
    pointsConfig.value = message.config;
  }));
  unsubscribers.push(control.onPush('leaderboard', (message) => {
    if (message.type !== 'leaderboard') return;
    boardSnapshotRevision += 1;
    pendingAwards.clear();
    replaceBoard(message.viewers);
  }));

  unsubscribers.push(control.onTopic<LeaderboardResult>('ui.points.snapshot', (data) => {
    if (disposed || !Array.isArray(data.viewers)) return;
    // The native projection is an absolute authoritative top-K snapshot.
    boardSnapshotRevision += 1;
    snapshotInFlight = false;
    refreshAwards.clear();
    pendingAwards.clear();
    replaceBoard(data.viewers);
  }));

  const refresh = async (): Promise<void> => {
    const generation = ++refreshGeneration;
    const startedAt = revision;
    const snapshotAtStart = boardSnapshotRevision;
    const configAtStart = configRevision;
    snapshotInFlight = true;
    refreshAwards.clear();
    try {
      const [config, board] = await Promise.all([
        control.call<PointsConfig>('points.config.get', {}),
        control.call<LeaderboardResult>('points.leaderboard', { limit: 100 }),
      ]);
      if (disposed || generation !== refreshGeneration) return;
      if (configAtStart === configRevision) pointsConfig.value = config;
      if (snapshotAtStart !== boardSnapshotRevision) return;
      // Discard patches covered by the snapshot; keep awards received while
      // the request was in flight, including ones already visually committed.
      for (const [id, award] of pendingAwards) {
        if (award.revision <= startedAt || !board.viewers.some((viewer) => viewer.uniqueId === id)) {
          pendingAwards.delete(id);
        }
      }
      replaceBoard(board.viewers.map((viewer) => {
        const award = refreshAwards.get(viewer.uniqueId);
        return award ? { ...viewer, points: award.totalPoints, level: award.level } : viewer;
      }).sort((left, right) => right.points - left.points));
    } catch (failure) {
      if (!disposed && generation === refreshGeneration) console.warn(`points refresh failed: ${errorMessage(failure)}`);
    } finally {
      if (generation === refreshGeneration) {
        snapshotInFlight = false;
        refreshAwards.clear();
      }
    }
  };

  // Awards for viewers missing from the loaded page re-read the board so
  // new chatters appear. Coalesced to at most one refresh per window: the
  // first miss in a quiet period refreshes immediately (leading edge), and
  // misses inside the window share one trailing refresh instead of one RPC
  // per unknown viewer. A burst of N new chatters costs one refresh now
  // and at most one catch-up later — never N.
  const MISSING_VIEWER_WINDOW_MS = 500;
  let missingViewerRefreshInFlight = false;
  let missingViewerWindowStart = 0;
  let missingViewerTimer: ReturnType<typeof setTimeout> | null = null;
  const startMissingViewerRefresh = (): void => {
    if (disposed) return;
    missingViewerRefreshInFlight = true;
    missingViewerWindowStart = Date.now();
    void refresh().finally(() => {
      missingViewerRefreshInFlight = false;
    });
  };
  const refreshMissingViewer = (): void => {
    if (!presentationActive) { hiddenMiss = true; return; }
    const now = Date.now();
    if (
      missingViewerRefreshInFlight ||
      now - missingViewerWindowStart < MISSING_VIEWER_WINDOW_MS
    ) {
      // Covered by the running refresh or one trailing catch-up: schedule
      // at most one timer so a sustained trickle still converges without
      // stacking timers.
      if (missingViewerTimer === null) {
        const wait = missingViewerRefreshInFlight
          ? MISSING_VIEWER_WINDOW_MS
          : MISSING_VIEWER_WINDOW_MS - (now - missingViewerWindowStart);
        missingViewerTimer = setTimeout(() => {
          missingViewerTimer = null;
          startMissingViewerRefresh();
        }, wait);
      }
      return;
    }
    startMissingViewerRefresh();
  };

  unsubscribers.push(control.onTopic<PointsChangedData>('points.changed', (data) => {
    if (!applyAward(data)) {
      refreshMissingViewer();
    }
  }));

  unsubscribers.push(control.onTopic('points.reset', () => {
    ++refreshGeneration;
    snapshotInFlight = false;
    pendingAwards.clear();
    refreshAwards.clear();
    lookupCache = null;
    refreshMissingViewer();
  }));

  const setPresentationActive = (active: boolean): void => {
    presentationActive = active;
    if (!active) {
      if (awardTimer !== null) clearTimeout(awardTimer);
      awardTimer = null;
      if (missingViewerTimer !== null) clearTimeout(missingViewerTimer);
      missingViewerTimer = null;
    } else if (hiddenMiss) {
      hiddenMiss = false;
      refreshMissingViewer();
    } else if (pendingAwards.size > 0 && awardTimer === null) {
      awardTimer = setTimeout(commitAwards, 100);
    }
  };

  const handleUpdatePointsConfig = (config: Partial<PointsConfig>): void => {
    void control
      .call<PointsConfig>('points.config.set', { ...config })
      .then((next) => {
        if (disposed) return;
        configRevision += 1;
        pointsConfig.value = next;
      })
      .catch((failure: unknown) => {
        console.warn(`points.config.set failed: ${errorMessage(failure)}`);
      });
  };

  const handleResetPoints = (uniqueId?: string): void => {
    void (async () => {
      try {
        await control.call('points.reset', uniqueId === undefined ? {} : { uniqueId });
        if (!disposed) await refresh();
      } catch (failure) {
        console.warn(`points.reset failed: ${errorMessage(failure)}`);
      }
    })();
  };

  const handleAdjustPoints = (uniqueId: string, delta: number): void => {
    // The leaderboard patch arrives via the points.changed event.
    void control.call('points.adjust', { uniqueId, delta }).catch((failure: unknown) => {
      console.warn(`points.adjust failed: ${errorMessage(failure)}`);
    });
  };

  /** Chat-rate lookup, memoized: the map rebuilds only when the board
   * array is replaced, keeping per-message resolution O(1) with
   * first-match wins (matching the previous linear scan). */
  const leaderboardPointsFor = (handle: string): number | undefined => {
    const clean = handle.trim().replace(/^@/, '').toLowerCase();
    if (!clean) return undefined;
    const board = leaderboard.value;
    if (lookupCache?.board !== board) {
      const map = new Map<string, number>();
      const owners = new Map<string, string>();
      for (const entry of board) {
        const key = entry.uniqueId.trim().replace(/^@/, '').toLowerCase();
        if (key && !map.has(key)) { map.set(key, entry.points); owners.set(key, entry.uniqueId); }
      }
      for (const award of pendingAwards.values()) {
        const key = award.uniqueId.trim().replace(/^@/, '').toLowerCase();
        if (owners.get(key) === award.uniqueId) map.set(key, award.totalPoints);
      }
      lookupCache = { board, map, owners };
    }
    return lookupCache.map.get(clean);
  };

  const dispose = (): void => {
    disposed = true;
    refreshGeneration += 1;
    if (awardTimer !== null) clearTimeout(awardTimer);
    awardTimer = null;
    pendingAwards.clear();
    refreshAwards.clear();
    while (unsubscribers.length > 0) unsubscribers.pop()?.();
    if (missingViewerTimer !== null) {
      clearTimeout(missingViewerTimer);
      missingViewerTimer = null;
    }
    lookupCache = null;
  };

  return {
    pointsConfig,
    setPresentationActive,
    leaderboard,
    leaderboardPointsFor,
    handleUpdatePointsConfig,
    handleResetPoints,
    handleAdjustPoints,
    refresh,
    dispose,
  };
}
