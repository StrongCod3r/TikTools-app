import { ref, shallowRef } from 'vue';
import type { PointsConfig, ViewerRecord } from '../../../../shared/messages.ts';
import type { ControlClient } from '@/shared/api/control-client.ts';
import { errorMessage } from '@/shared/api/control-client.ts';
import { defaultPointsConfig } from './default-config.ts';

interface LeaderboardResult {
  viewers: ViewerRecord[];
}

export interface PointsChangedData {
  uniqueId: string;
  delta: number;
  totalPoints: number;
  level: number;
}

const AWARD_COMMIT_MS = 100;
const MISSING_VIEWER_WINDOW_MS = 500;

export function createPointsState(control: ControlClient) {
  const pointsConfig = ref<PointsConfig>(defaultPointsConfig);
  const leaderboard = shallowRef<ViewerRecord[]>([]);
  const error = ref<string | null>(null);
  const unsubscribers: Array<() => void> = [];

  let disposed = false;
  let presentationActive = true;
  let hiddenMiss = false;
  let revision = 0;
  let refreshGeneration = 0;
  let boardSnapshotRevision = 0;
  let configRevision = 0;
  let awardTimer: ReturnType<typeof setTimeout> | null = null;
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
    if (presentationActive && awardTimer === null) awardTimer = setTimeout(commitAwards, AWARD_COMMIT_MS);
    return true;
  };

  unsubscribers.push(
    control.onPush('points-config', (message) => {
      if (message.type !== 'points-config') return;
      configRevision += 1;
      pointsConfig.value = message.config;
    }),
  );
  unsubscribers.push(
    control.onPush('leaderboard', (message) => {
      if (message.type !== 'leaderboard') return;
      boardSnapshotRevision += 1;
      pendingAwards.clear();
      replaceBoard(message.viewers);
    }),
  );
  unsubscribers.push(
    control.onTopic<LeaderboardResult>('ui.points.snapshot', (data) => {
      if (disposed || !Array.isArray(data.viewers)) return;
      boardSnapshotRevision += 1;
      snapshotInFlight = false;
      refreshAwards.clear();
      pendingAwards.clear();
      replaceBoard(data.viewers);
    }),
  );

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
      error.value = null;
      if (configAtStart === configRevision) pointsConfig.value = config;
      if (snapshotAtStart !== boardSnapshotRevision) return;
      for (const [id, award] of pendingAwards) {
        if (award.revision <= startedAt || !board.viewers.some((viewer) => viewer.uniqueId === id)) {
          pendingAwards.delete(id);
        }
      }
      replaceBoard(
        board.viewers
          .map((viewer) => {
            const award = refreshAwards.get(viewer.uniqueId);
            return award ? { ...viewer, points: award.totalPoints, level: award.level } : viewer;
          })
          .sort((left, right) => right.points - left.points),
      );
    } catch (failure) {
      if (!disposed && generation === refreshGeneration) error.value = errorMessage(failure);
    } finally {
      if (generation === refreshGeneration) {
        snapshotInFlight = false;
        refreshAwards.clear();
      }
    }
  };

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
    if (!presentationActive) {
      hiddenMiss = true;
      return;
    }
    const now = Date.now();
    if (missingViewerRefreshInFlight || now - missingViewerWindowStart < MISSING_VIEWER_WINDOW_MS) {
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

  unsubscribers.push(
    control.onTopic<PointsChangedData>('points.changed', (data) => {
      if (!applyAward(data)) refreshMissingViewer();
    }),
  );
  unsubscribers.push(
    control.onTopic('points.reset', () => {
      ++refreshGeneration;
      snapshotInFlight = false;
      pendingAwards.clear();
      refreshAwards.clear();
      refreshMissingViewer();
    }),
  );

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
      awardTimer = setTimeout(commitAwards, AWARD_COMMIT_MS);
    }
  };

  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    error.value = null;
    try {
      return await operation();
    } catch (failure) {
      if (!disposed) error.value = errorMessage(failure);
      throw failure;
    }
  };

  const updateConfig = (config: Partial<PointsConfig>): Promise<void> =>
    run(async () => {
      const next = await control.call<PointsConfig>('points.config.set', { ...config });
      if (disposed) return;
      configRevision += 1;
      pointsConfig.value = next;
    });

  const reset = (uniqueId?: string): Promise<void> =>
    run(async () => {
      await control.call('points.reset', uniqueId === undefined ? {} : { uniqueId });
      if (!disposed) await refresh();
    });

  const adjust = (uniqueId: string, delta: number): Promise<void> =>
    run(async () => {
      await control.call('points.adjust', { uniqueId, delta });
    });

  const dispose = (): void => {
    disposed = true;
    refreshGeneration += 1;
    if (awardTimer !== null) clearTimeout(awardTimer);
    awardTimer = null;
    pendingAwards.clear();
    refreshAwards.clear();
    while (unsubscribers.length > 0) unsubscribers.pop()?.();
    if (missingViewerTimer !== null) clearTimeout(missingViewerTimer);
    missingViewerTimer = null;
  };

  return {
    pointsConfig,
    leaderboard,
    error,
    setPresentationActive,
    refresh,
    updateConfig,
    reset,
    adjust,
    dispose,
  };
}
