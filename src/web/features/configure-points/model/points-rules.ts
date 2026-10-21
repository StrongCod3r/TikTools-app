import type { PointsConfig } from '../../../../shared/messages.ts';

type NumericKey = {
  [K in keyof PointsConfig]: PointsConfig[K] extends number ? K : never;
}[keyof PointsConfig];

type ToggleKey = {
  [K in keyof PointsConfig]: PointsConfig[K] extends boolean ? K : never;
}[keyof PointsConfig];

export interface PointsRule {
  id: 'coin' | 'share' | 'chat' | 'like' | 'follow' | 'join';
  rate: NumericKey;
  enabled: ToggleKey;
  step: number;
}

export const pointsRules: readonly PointsRule[] = [
  { id: 'coin', rate: 'pointsPerCoin', enabled: 'pointsPerCoinEnabled', step: 0.1 },
  { id: 'chat', rate: 'pointsPerChat', enabled: 'pointsPerChatEnabled', step: 0.1 },
  { id: 'like', rate: 'pointsPerLike', enabled: 'pointsPerLikeEnabled', step: 0.05 },
  { id: 'share', rate: 'pointsPerShare', enabled: 'pointsPerShareEnabled', step: 0.5 },
  { id: 'follow', rate: 'pointsPerFollow', enabled: 'pointsPerFollowEnabled', step: 1 },
  { id: 'join', rate: 'pointsPerJoin', enabled: 'pointsPerJoinEnabled', step: 0.5 },
];

export const MIN_POINTS_PER_LEVEL = 10;

export function normalizePointsConfig(config: PointsConfig): PointsConfig {
  const rates = Object.fromEntries(pointsRules.map((rule) => [rule.rate, Math.max(0, config[rule.rate])]));
  return {
    ...config,
    ...rates,
    currencyName: config.currencyName.trim() || 'Points',
    subBonusMultiplier: Math.min(500, Math.max(0, config.subBonusMultiplier)),
    pointsPerLevel: Math.max(MIN_POINTS_PER_LEVEL, Math.round(config.pointsPerLevel)),
  };
}

export function isConfigDirty(draft: PointsConfig, saved: PointsConfig): boolean {
  return (Object.keys(saved) as (keyof PointsConfig)[]).some((key) => draft[key] !== saved[key]);
}
