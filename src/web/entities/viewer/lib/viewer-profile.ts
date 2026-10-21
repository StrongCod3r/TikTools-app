import type { UserCardUser, ViewerRecord } from '@/types.ts';

export interface ViewerIdentity {
  uniqueId: string;
  nickname?: string;
  avatarUrl?: string;
}

export function enrichViewer(identity: ViewerIdentity, leaderboard: readonly ViewerRecord[]): UserCardUser {
  const record = leaderboard.find((entry) => entry.uniqueId === identity.uniqueId);
  return {
    uniqueId: identity.uniqueId,
    nickname: identity.nickname ?? record?.nickname,
    avatarUrl: identity.avatarUrl ?? record?.avatarUrl,
    points: record?.points,
    level: record?.level,
    isSubscriber: record?.isSubscriber,
    totalChats: record?.totalChats,
    totalCoins: record?.totalCoins,
    totalLikes: record?.totalLikes,
    totalShares: record?.totalShares,
    firstSeen: record?.firstSeen,
    lastSeen: record?.lastSeen,
  };
}

export function sameHandle(left: string, right: string): boolean {
  return left.replace(/^@+/, '').trim().toLowerCase() === right.replace(/^@+/, '').trim().toLowerCase();
}
