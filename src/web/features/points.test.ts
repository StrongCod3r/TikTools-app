import { describe, expect, test } from 'bun:test';

import type { ControlClient, RpcParams } from '../platform/control-client.ts';
import type { ViewerRecord } from '../types.ts';
import { defaultPointsConfig, usePoints } from './points.ts';

function viewer(uniqueId: string, points: number): ViewerRecord {
  return {
    uniqueId,
    points,
    level: 1,
    isSubscriber: false,
    totalChats: 0,
    totalCoins: 0,
    totalLikes: 0,
    totalShares: 0,
    firstSeen: 0,
    lastSeen: 0,
  };
}

function stubControl(board: ViewerRecord[]): ControlClient & {
  calls: string[];
  topics: Map<string, (data: never) => void>;
} {
  const calls: string[] = [];
  const topics = new Map<string, (data: never) => void>();
  return {
    calls,
    topics,
    attach: () => {},
    detach: () => {},
    call: <T,>(method: string, _params?: RpcParams): Promise<T> => {
      void _params;
      calls.push(method);
      if (method === 'points.leaderboard') return Promise.resolve({ viewers: board } as T);
      if (method === 'points.config.get') return Promise.resolve(defaultPointsConfig as T);
      return Promise.reject(new Error(`unstubbed ${method}`)) as Promise<T>;
    },
    onTopic: <T,>(topic: string, handler: (data: T) => void): (() => void) => {
      topics.set(topic, handler as (data: never) => void);
      return () => {};
    },
    onPush: () => () => {},
    onTransportError: () => () => {},
    onGap: () => () => {},
  };
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('usePoints new viewers', () => {
  test('awards for unknown viewers refresh the board so they appear', async () => {
    const board = [viewer('new-user', 5)];
    const control = stubControl(board);
    const points = usePoints(control);
    expect(points.leaderboard.value).toHaveLength(0);

    const handler = control.topics.get('points.changed');
    expect(handler).toBeDefined();
    handler?.({ uniqueId: 'new-user', delta: 5, totalPoints: 5, level: 1 } as never);
    await flushPromises();

    expect(control.calls).toContain('points.leaderboard');
    expect(points.leaderboard.value.map((entry) => entry.uniqueId)).toContain('new-user');
  });

  test('awards for known viewers patch locally without a refresh', async () => {
    const control = stubControl([viewer('alice', 10)]);
    const points = usePoints(control);
    await points.refresh();
    const callsBefore = control.calls.length;

    const handler = control.topics.get('points.changed');
    handler?.({ uniqueId: 'alice', delta: 2, totalPoints: 12, level: 1 } as never);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(control.calls).toHaveLength(callsBefore);
    expect(points.leaderboard.value[0]?.points).toBe(12);
  });

  test('a burst of unknown viewers triggers only one refresh', async () => {
    const control = stubControl([viewer('a', 1), viewer('b', 1)]);
    const points = usePoints(control);
    const handler = control.topics.get('points.changed');
    expect(handler).toBeDefined();

    handler?.({ uniqueId: 'a', delta: 1, totalPoints: 1, level: 1 } as never);
    handler?.({ uniqueId: 'b', delta: 1, totalPoints: 1, level: 1 } as never);
    handler?.({ uniqueId: 'c', delta: 1, totalPoints: 1, level: 1 } as never);
    await flushPromises();

    expect(control.calls.filter((method) => method === 'points.leaderboard')).toHaveLength(1);
    expect(points.leaderboard.value).toHaveLength(2);
  });
});


test('10k absolute awards produce one board replacement and current lookups', async () => {
  const control = stubControl([viewer('alice', 10), viewer('bob', 20)]);
  const points = usePoints(control);
  await points.refresh();
  const before = points.leaderboard.value;
  const handler = control.topics.get('points.changed');
  for (let i = 0; i < 10_000; i += 1) {
    handler?.({ uniqueId: 'alice', delta: 1, totalPoints: i, level: 2 } as never);
  }
  expect(points.leaderboard.value).toBe(before);
  expect(points.leaderboardPointsFor('@ALICE')).toBe(9_999);
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(points.leaderboard.value).not.toBe(before);
  expect(points.leaderboard.value[0]?.points).toBe(9_999);
  expect(control.calls.filter((method) => method === 'points.leaderboard')).toHaveLength(1);
  points.dispose();
});

test('dispose cancels pending award commits', async () => {
  const control = stubControl([viewer('alice', 10)]);
  const points = usePoints(control);
  await points.refresh();
  const before = points.leaderboard.value;
  control.topics.get('points.changed')?.({ uniqueId: 'alice', totalPoints: 12, level: 1 } as never);
  points.dispose();
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(points.leaderboard.value).toBe(before);
});

test('an in-flight snapshot preserves awards committed after the request began', async () => {
  const control = stubControl([viewer('alice', 10)]);
  const points = usePoints(control);
  await points.refresh();
  const originalCall = control.call;
  let resolveBoard!: (value: unknown) => void;
  control.call = <T,>(method: string, params?: RpcParams): Promise<T> => {
    if (method === 'points.leaderboard') {
      return new Promise((resolve) => { resolveBoard = resolve as (value: unknown) => void; });
    }
    return originalCall<T>(method, params);
  };
  const refreshing = points.refresh();
  control.topics.get('points.changed')?.({ uniqueId: 'alice', totalPoints: 25, level: 2 } as never);
  await new Promise((resolve) => setTimeout(resolve, 120));
  resolveBoard({ viewers: [viewer('alice', 10)] });
  await refreshing;
  expect(points.leaderboard.value[0]?.points).toBe(25);
  expect(points.leaderboardPointsFor('alice')).toBe(25);
  points.dispose();
});

test('native board snapshots supersede slow board RPCs while config refresh still completes', async () => {
  const control = stubControl([viewer('alice', 10)]);
  const original = control.call;
  let resolveBoard!: (value: unknown) => void;
  control.call = <T,>(method: string, params?: RpcParams): Promise<T> => {
    if (method === 'points.config.get') return Promise.resolve({ ...defaultPointsConfig, currencyName: 'Coins' } as T);
    if (method === 'points.leaderboard') return new Promise((resolve) => { resolveBoard = resolve as (value: unknown) => void; });
    return original<T>(method, params);
  };
  const points = usePoints(control);
  const refreshing = points.refresh();
  control.topics.get('ui.points.snapshot')?.({ viewers: [viewer('alice', 25)] } as never);
  resolveBoard({ viewers: [viewer('alice', 10)] });
  await refreshing;
  expect(points.leaderboard.value[0]?.points).toBe(25);
  expect(points.pointsConfig.value.currencyName).toBe('Coins');
  points.dispose();
});
