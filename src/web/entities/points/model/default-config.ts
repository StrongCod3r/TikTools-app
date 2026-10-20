import type { PointsConfig } from '../../../../shared/messages.ts';

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
