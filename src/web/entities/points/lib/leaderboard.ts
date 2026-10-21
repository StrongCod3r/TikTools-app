import type { ViewerRecord } from '../../../../shared/messages.ts';

export type LeaderboardSortKey = 'rank' | 'uniqueId' | 'level' | 'points';

export interface RankedViewer extends ViewerRecord {
  rank: number;
}

export function rankViewers(viewers: readonly ViewerRecord[]): RankedViewer[] {
  return viewers.map((viewer, index) => ({ ...viewer, rank: index + 1 }));
}

export function filterViewers(rows: readonly RankedViewer[], query: string): RankedViewer[] {
  const needle = query.trim().replace(/^@/, '').toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(
    (row) => row.uniqueId.toLowerCase().includes(needle) || (row.nickname?.toLowerCase().includes(needle) ?? false),
  );
}

export function sortViewers(rows: readonly RankedViewer[], key: LeaderboardSortKey, direction: 'asc' | 'desc'): RankedViewer[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const order = key === 'uniqueId' ? left.uniqueId.localeCompare(right.uniqueId) : left[key] - right[key];
    return order * factor || left.rank - right.rank;
  });
}
