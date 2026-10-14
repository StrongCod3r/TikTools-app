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
  let lookupCache: { board: ViewerRecord[]; map: Map<string, number> } | null = null;

  const applyAward = (uniqueId: string, totalPoints: number, level: number): boolean => {
    const index = leaderboard.value.findIndex((viewer) => viewer.uniqueId === uniqueId);
    if (index < 0) return false;
    const updated = [...leaderboard.value];
    const current = updated[index];
    if (current) {
      updated[index] = {
        ...current,
        points: totalPoints,
        level,
        lastSeen: Date.now(),
      };
    }
    leaderboard.value = updated.sort((left, right) => right.points - left.points);
    return true;
  };

  unsubscribers.push(control.onPush('points-config', (message) => {
    if (message.type !== 'points-config') return;
    pointsConfig.value = message.config;
  }));
  unsubscribers.push(control.onPush('leaderboard', (message) => {
    if (message.type !== 'leaderboard') return;
    leaderboard.value = message.viewers;
  }));

  const refresh = async (): Promise<void> => {
    try {
      const [config, board] = await Promise.all([
        control.call<PointsConfig>('points.config.get', {}),
        control.call<LeaderboardResult>('points.leaderboard', { limit: 100 }),
      ]);
      pointsConfig.value = config;
      leaderboard.value = board.viewers;
    } catch (failure) {
      console.warn(`points refresh failed: ${errorMessage(failure)}`);
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
    missingViewerRefreshInFlight = true;
    missingViewerWindowStart = Date.now();
    void refresh().finally(() => {
      missingViewerRefreshInFlight = false;
    });
  };
  const refreshMissingViewer = (): void => {
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
    if (!applyAward(data.uniqueId, data.totalPoints, data.level)) {
      refreshMissingViewer();
    }
  }));

  const handleUpdatePointsConfig = (config: Partial<PointsConfig>): void => {
    void control
      .call<PointsConfig>('points.config.set', { ...config })
      .then((next) => {
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
        const board = await control.call<LeaderboardResult>('points.leaderboard', {
          limit: 100,
        });
        leaderboard.value = board.viewers;
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
      for (const entry of board) {
        const key = entry.uniqueId.trim().replace(/^@/, '').toLowerCase();
        if (key && !map.has(key)) map.set(key, entry.points);
      }
      lookupCache = { board, map };
    }
    return lookupCache.map.get(clean);
  };

  const dispose = (): void => {
    while (unsubscribers.length > 0) unsubscribers.pop()?.();
    if (missingViewerTimer !== null) {
      clearTimeout(missingViewerTimer);
      missingViewerTimer = null;
    }
    lookupCache = null;
  };

  return {
    pointsConfig,
    leaderboard,
    leaderboardPointsFor,
    handleUpdatePointsConfig,
    handleResetPoints,
    handleAdjustPoints,
    refresh,
    dispose,
  };
}
