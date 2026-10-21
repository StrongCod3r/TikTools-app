import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveFeedState } from './live-feed-state.ts';
import type { ControlClient } from '@/shared/api/control-client.ts';

function callbacks(systemAuthor: string) {
  return { systemAuthor: () => systemAuthor, discontinuityText: () => 'Feed resumed. Events received while hidden were skipped.' };
}

const frameQueue: Array<() => void> = [];
let frameId = 0;

function installFrameControl(): void {
  frameQueue.length = 0;
  (globalThis as Record<string, unknown>).requestAnimationFrame = (callback: () => void) => {
    frameQueue.push(callback);
    frameId += 1;
    return frameId;
  };
  (globalThis as Record<string, unknown>).cancelAnimationFrame = () => {};
}

function uninstallFrameControl(): void {
  frameQueue.length = 0;
  delete (globalThis as Record<string, unknown>).requestAnimationFrame;
  delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
}

function runFrames(count = 10): void {
  for (let i = 0; i < count && frameQueue.length > 0; i += 1) {
    const pending = frameQueue.splice(0, frameQueue.length);
    for (const callback of pending) callback();
  }
}

type TopicHandler = (data: never) => void;

function createControl() {
  const handlers = new Map<string, TopicHandler[]>();
  const unsubscribed: string[] = [];
  return {
    handlers,
    unsubscribed,
    control: {
      onTopic: (topic: string, handler: TopicHandler) => {
        const list = handlers.get(topic) ?? [];
        list.push(handler);
        handlers.set(topic, list);
        return () => {
          unsubscribed.push(topic);
          handlers.set(
            topic,
            (handlers.get(topic) ?? []).filter((entry) => entry !== handler),
          );
        };
      },
      onPush: () => () => {},
    } as never as ControlClient,
    emit(topic: string, data: never): void {
      for (const handler of handlers.get(topic) ?? []) handler(data);
    },
  };
}

const chatEvent = (prefix: string, author: string, index: number) => ({
  event: {
    kind: 'chat' as const,
    author: `${prefix}-${author}`,
    text: `${prefix} message ${index}`,
  },
});

describe('live feed batching', () => {
  beforeEach(() => {
    installFrameControl();
    return () => uninstallFrameControl();
  });

  it('a 1,000-event burst renders one frame, capped at 300 visible', () => {
    const harness = createControl();
    const live = createLiveFeedState(harness.control, callbacks('system'));
    for (let i = 0; i < 1000; i += 1) {
      harness.emit('live.ui-event', chatEvent('burst', `user-${i}`, i) as never);
    }
    expect(live.events.value).toHaveLength(0);
    runFrames(1);
    expect(live.events.value).toHaveLength(300);
    expect(live.events.value[0]?.author).toBe('burst-user-700');
    expect(live.droppedUiEvents.value).toBe(100);
    live.dispose();
  });

  it('paused auto-scroll never mutates scroll and counts unread in bulk', () => {
    const harness = createControl();
    const live = createLiveFeedState(harness.control, callbacks('system'));
    live.handleToggleAutoScroll();
    expect(live.autoScroll.value).toBe(false);
    for (let i = 0; i < 10; i += 1) {
      harness.emit('live.ui-event', chatEvent('paused', `user-${i}`, i) as never);
    }
    runFrames(2);
    expect(live.unreadCount.value).toBe(10);
    live.scrollToBottom();
    runFrames(2);
    expect(live.unreadCount.value).toBe(10);
    live.dispose();
  });

  it('reconnect reset clears feed, staging, and counters', () => {
    const harness = createControl();
    const live = createLiveFeedState(harness.control, callbacks('system'));
    for (let i = 0; i < 5; i += 1) {
      harness.emit('live.ui-event', chatEvent('reset', `user-${i}`, i) as never);
    }
    live.resetEvents();
    runFrames(2);
    expect(live.events.value).toHaveLength(0);
    expect(live.unreadCount.value).toBe(0);
    live.dispose();
  });

  it('dispose cancels frames and unsubscribes topics', () => {
    const harness = createControl();
    const live = createLiveFeedState(harness.control, callbacks('system'));
    harness.emit('live.ui-event', chatEvent('dispose', 'user-0', 0) as never);
    live.dispose();
    runFrames(3);
    expect(live.events.value).toHaveLength(0);
    harness.emit('live.ui-event', chatEvent('dispose', 'user-1', 1) as never);
    runFrames(3);
    expect(live.events.value).toHaveLength(0);
    expect(harness.unsubscribed).toContain('live.ui-event');
    expect(harness.unsubscribed).toContain('room.stats');
  });

  it('duplicate replays never reach the staged buffer', () => {
    const harness = createControl();
    const live = createLiveFeedState(harness.control, callbacks('system'));
    const payload = {
      event: { kind: 'chat' as const, author: 'alice', text: 'hello', msgId: 'replay-1' },
    };
    harness.emit('live.ui-event', payload as never);
    harness.emit('live.ui-event', payload as never);
    runFrames(2);
    expect(live.events.value).toHaveLength(1);
    live.dispose();
  });
});

it('feed identity caches belong to an instance and preserve only the same room', () => {
  installFrameControl();
  const harness = createControl();
  const live = createLiveFeedState(harness.control, callbacks('system'));
  const event = { event: { kind: 'chat', author: 'viewer', text: 'hello', msgId: 'stable' } };
  harness.emit('live.connected', { uniqueId: 'a', roomId: '1' } as never);
  harness.emit('live.ui-event', event as never);
  runFrames();
  live.resetEvents();
  harness.emit('live.connected', { uniqueId: 'a', roomId: '1' } as never);
  harness.emit('live.ui-event', event as never);
  runFrames();
  expect(live.events.value).toHaveLength(0);
  harness.emit('live.connected', { uniqueId: 'b', roomId: '2' } as never);
  harness.emit('live.ui-event', event as never);
  runFrames();
  expect(live.events.value).toHaveLength(1);
  live.dispose();
  const next = createLiveFeedState(harness.control, callbacks('system'));
  harness.emit('live.ui-event', event as never);
  runFrames();
  expect(next.events.value).toHaveLength(1);
  next.dispose();
  uninstallFrameControl();
});

it('message IDs expire after the replay age limit', () => {
  installFrameControl();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
  const harness = createControl();
  const live = createLiveFeedState(harness.control, callbacks('system'));
  try {
    const event = { event: { kind: 'chat', author: 'viewer', text: 'hello', msgId: 'aged' } };
    harness.emit('live.ui-event', event as never);
    runFrames();
    live.resetEvents();
    harness.emit('live.ui-event', event as never);
    runFrames();
    expect(live.events.value).toHaveLength(0);
    clock.mockReturnValue(10 * 60_000 + 1);
    harness.emit('live.ui-event', event as never);
    runFrames();
    expect(live.events.value).toHaveLength(1);
  } finally {
    live.dispose();
    clock.mockRestore();
    uninstallFrameControl();
  }
});

it('hidden feed cancels staged commits and returns with a bounded discontinuity', () => {
  installFrameControl();
  const control = createControl();
  const live = createLiveFeedState(control.control, callbacks('System'));
  const send = (id: number) => control.handlers.get('live.ui-event')?.forEach((handler) =>
    handler({ event: { kind: 'chat', author: 'alice', text: String(id), msgId: String(id) } } as never));
  send(0);
  live.setPresentationActive(false);
  const before = live.events.value;
  for (let i = 1; i <= 10_000; i += 1) send(i);
  runFrames();
  expect(live.events.value).toBe(before);
  expect(live.diagnostics().staged).toBe(0);
  expect(live.diagnostics().commits).toBe(0);
  expect(live.droppedUiEvents.value).toBe(10_001);
  live.setPresentationActive(true);
  send(10_001);
  runFrames();
  expect(live.events.value).toHaveLength(2);
  expect(live.events.value[0]?.text).toContain('Feed resumed');
  live.dispose();
  uninstallFrameControl();
});

it('a stalled native frame clock commits via one bounded timeout and disposal cancels it', async () => {
  installFrameControl();
  const control = createControl();
  const live = createLiveFeedState(control.control, callbacks('System'));
  control.emit('live.ui-event', chatEvent('stalled-clock', 'alice', 1) as never);
  expect(live.events.value).toHaveLength(0);
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(live.events.value).toHaveLength(1);
  expect(live.diagnostics().commits).toBe(1);
  runFrames();
  expect(live.diagnostics().commits).toBe(1);
  control.emit('live.ui-event', chatEvent('stalled-clock', 'alice', 2) as never);
  live.dispose();
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(live.diagnostics().commits).toBe(1);
  expect(live.diagnostics().timers).toBe(0);
  uninstallFrameControl();
});

it('feed counts source-bus and transport shedding separately without counting suspension twice', () => {
  installFrameControl();
  const control = createControl();
  const live = createLiveFeedState(control.control, callbacks('System'));
  control.emit('ui.projection.stats', { feedSuspended: 0, feedBusDropped: 0, feedForwarded: 0 } as never);
  control.emit('live.ui-event', { ...chatEvent('sequence', 'alice', 1), sequence: 1 } as never);
  control.emit('live.ui-event', { ...chatEvent('sequence', 'alice', 2), sequence: 4 } as never);
  control.emit('ui.projection.stats', { feedSuspended: 5, feedBusDropped: 3, feedForwarded: 4 } as never);
  expect(live.droppedUiEvents.value).toBe(10);
  control.emit('ui.projection.stats', { feedSuspended: 5, feedBusDropped: 3, feedForwarded: 4 } as never);
  expect(live.droppedUiEvents.value).toBe(10);
  live.dispose();
  uninstallFrameControl();
});

function createBackfillControl(responder: (params: { after: number }) => unknown) {
  const handlers = new Map<string, TopicHandler[]>();
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    handlers,
    calls,
    control: {
      onTopic: (topic: string, handler: TopicHandler) => {
        const list = handlers.get(topic) ?? [];
        list.push(handler);
        handlers.set(topic, list);
        return () => {
          handlers.set(
            topic,
            (handlers.get(topic) ?? []).filter((entry) => entry !== handler),
          );
        };
      },
      onPush: () => () => {},
      call: async (method: string, params: unknown) => {
        calls.push({ method, params });
        return responder(params as { after: number });
      },
    } as never as ControlClient,
    emit(topic: string, data: never): void {
      for (const handler of handlers.get(topic) ?? []) handler(data);
    },
  };
}

it('returning from a hidden feed replays retained native events instead of a marker', async () => {
  installFrameControl();
  const harness = createBackfillControl(() => ({
    oldestCursor: 9,
    latestCursor: 12,
    depth: 4,
    gap: false,
    truncated: false,
    events: [
      { cursor: 11, event: { kind: 'chat', author: 'a', text: 'recovered-11', msgId: 'r11' } },
      { cursor: 12, event: { kind: 'chat', author: 'a', text: 'recovered-12', msgId: 'r12' } },
    ],
  }));
  const live = createLiveFeedState(harness.control, callbacks('System'));
  harness.emit('live.ui-event', { event: { kind: 'chat', author: 'a', text: 'live-10', msgId: 'l10' }, cursor: 10 } as never);
  runFrames();
  live.setPresentationActive(false);
  harness.emit('live.ui-event', { event: { kind: 'chat', author: 'a', text: 'hidden-11', msgId: 'h11' }, cursor: 11 } as never);
  harness.emit('live.ui-event', { event: { kind: 'chat', author: 'a', text: 'hidden-12', msgId: 'h12' }, cursor: 12 } as never);
  runFrames();
  expect(live.events.value).toHaveLength(1);
  expect(live.droppedUiEvents.value).toBe(2);
  live.setPresentationActive(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  runFrames();
  expect(harness.calls).toEqual([{ method: 'ui.feed.backfill', params: { version: 1, after: 10 } }]);
  const texts = live.events.value.map((event) => event.text);
  expect(texts).toContain('live-10');
  expect(texts).toContain('recovered-11');
  expect(texts).toContain('recovered-12');
  expect(texts.some((text) => text?.includes('Feed resumed'))).toBe(false);
  expect(live.diagnostics().cursor).toBe(12);
  expect(live.droppedUiEvents.value).toBe(0);
  live.dispose();
  uninstallFrameControl();
});

it('a gap or truncation in the native replay still inserts a discontinuity marker', async () => {
  installFrameControl();
  const harness = createBackfillControl(() => ({
    oldestCursor: 9,
    latestCursor: 12,
    depth: 4,
    gap: true,
    truncated: false,
    events: [{ cursor: 11, event: { kind: 'chat', author: 'a', text: 'recovered-11', msgId: 'r11' } }],
  }));
  const live = createLiveFeedState(harness.control, callbacks('System'));
  harness.emit('live.ui-event', { event: { kind: 'chat', author: 'a', text: 'live-10', msgId: 'l10' }, cursor: 10 } as never);
  runFrames();
  live.setPresentationActive(false);
  harness.emit('live.ui-event', { event: { kind: 'chat', author: 'a', text: 'hidden-11', msgId: 'h11' }, cursor: 11 } as never);
  live.setPresentationActive(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  runFrames();
  const texts = live.events.value.map((event) => event.text);
  expect(texts).toContain('recovered-11');
  expect(texts.some((text) => text?.includes('Feed resumed'))).toBe(true);
  live.dispose();
  uninstallFrameControl();
});

it('a failed native replay degrades to the remaining discontinuity marker', async () => {
  installFrameControl();
  const harness = createBackfillControl(() => {
    throw new Error('host unavailable');
  });
  const live = createLiveFeedState(harness.control, callbacks('System'));
  harness.emit('live.ui-event', { event: { kind: 'chat', author: 'a', text: 'live-10', msgId: 'l10' }, cursor: 10 } as never);
  runFrames();
  live.setPresentationActive(false);
  harness.emit('live.ui-event', { event: { kind: 'chat', author: 'a', text: 'hidden-11', msgId: 'h11' }, cursor: 11 } as never);
  live.setPresentationActive(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  runFrames();
  expect(live.events.value.some((event) => event.text?.includes('Feed resumed'))).toBe(true);
  live.dispose();
  uninstallFrameControl();
});
