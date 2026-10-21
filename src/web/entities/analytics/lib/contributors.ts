import type { AnalyticsTopViewer } from '../../../../shared/messages.ts';

export type ContributorSortKey = 'rank' | 'uniqueId' | 'chats' | 'gifts' | 'diamonds' | 'interactions' | 'lastSeen';

export interface RankedContributor extends AnalyticsTopViewer {
  rank: number;
}

export function rankContributors(viewers: readonly AnalyticsTopViewer[]): RankedContributor[] {
  return viewers.map((viewer, index) => ({ ...viewer, rank: index + 1 }));
}

export function filterContributors(rows: readonly RankedContributor[], query: string): RankedContributor[] {
  const needle = query.trim().replace(/^@/, '').toLowerCase();
  return needle ? rows.filter((row) => row.uniqueId.toLowerCase().includes(needle)) : [...rows];
}

export function sortContributors(
  rows: readonly RankedContributor[],
  key: ContributorSortKey,
  direction: 'asc' | 'desc',
): RankedContributor[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = left[key];
    const b = right[key];
    const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
    return order * factor || left.rank - right.rank;
  });
}
