import type { TopViewerPayload, ViewerRecord } from '@/types.ts';

export interface RankedViewerEntry {
  key: string;
  rank: number;
  uniqueId: string;
  nickname?: string;
  avatarUrl?: string;
  score: number;
}

export function rankedViewers(topViewers: readonly TopViewerPayload[], leaderboard: readonly ViewerRecord[]): RankedViewerEntry[] {
  if (topViewers.length) {
    return topViewers.slice(0, 6).map((viewer, index) => ({
      key: viewer.uniqueId,
      rank: viewer.rank || index + 1,
      uniqueId: viewer.uniqueId,
      nickname: viewer.nickname,
      avatarUrl: viewer.avatarUrl,
      score: viewer.score,
    }));
  }
  return leaderboard.slice(0, 3).map((viewer, index) => ({
    key: viewer.uniqueId,
    rank: index + 1,
    uniqueId: viewer.uniqueId,
    nickname: viewer.nickname,
    avatarUrl: viewer.avatarUrl,
    score: viewer.points,
  }));
}
