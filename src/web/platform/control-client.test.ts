import { expect, test } from 'bun:test';

import { createControlClient } from './control-client.ts';

type MockIpc = {
  sent: string[];
  postMessage: (message: string) => void;
};

function installMockIpc(): MockIpc {
  const mock: MockIpc = {
    sent: [],
    postMessage(message: string): void {
      mock.sent.push(message);
    },
  };
  (globalThis as Record<string, unknown>)['window'] = { ipc: mock };
  return mock;
}

function sentId(): string {
  const target = (globalThis as Record<string, unknown>)['window'] as Record<string, unknown>;
  const mock = target['ipc'] as MockIpc;
  return (JSON.parse(mock.sent.at(-1) as string) as { id: string }).id;
}

function hostMessage(): (raw: string) => void {
  const target = (globalThis as Record<string, unknown>)['window'] as Record<string, unknown>;
  const receive = target['__webview_on_message__'] as (raw: string) => void;
  expect(receive).toBeFunction();
  return receive;
}

test('call resolves with the result of the matching rpc-response', async () => {
  installMockIpc();
  const control = createControlClient();
  control.attach();
  const pending = control.call<{ ok: boolean }>('system.ping', {});
  const mock = ((globalThis as Record<string, unknown>)['window'] as Record<string, unknown>)[
    'ipc'
  ] as MockIpc;
  expect(JSON.parse(mock.sent[0] as string)).toMatchObject({
    jsonrpc: '2.0',
    id: expect.any(String),
    method: 'system.ping',
  });
  const receive = hostMessage();
  receive(JSON.stringify({ type: 'rpc-response', response: { id: sentId(), result: { ok: true } } }));
  await expect(pending).resolves.toEqual({ ok: true });
  control.detach();
  delete (globalThis as Record<string, unknown>)['window'];
});

test('call rejects with the host error code and message', async () => {
  installMockIpc();
  const control = createControlClient();
  control.attach();
  const pending = control.call('plugins.get', { pluginId: 'missing' });
  hostMessage()(
    JSON.stringify({
      type: 'rpc-response',
      response: { id: sentId(), error: { code: 'plugin_not_found', message: 'nope' } },
    }),
  );
  await expect(pending).rejects.toMatchObject({ code: 'plugin_not_found', message: 'nope' });
  control.detach();
  delete (globalThis as Record<string, unknown>)['window'];
});

test('call rejects without a native bridge', async () => {
  (globalThis as Record<string, unknown>)['window'] = {};
  const control = createControlClient();
  control.attach();
  await expect(control.call('system.ping')).rejects.toMatchObject({ code: 'transport' });
  control.detach();
  delete (globalThis as Record<string, unknown>)['window'];
});

test('call rejects oversized payloads before postMessage', async () => {
  const mock = installMockIpc();
  const control = createControlClient({ timeoutMs: 5 });
  control.attach();
  const huge = 'x'.repeat(1024 * 1024 + 1);
  await expect(control.call('system.ping', { blob: huge })).rejects.toMatchObject({
    code: 'too_large',
  });
  expect(mock.sent).toHaveLength(0);
  control.detach();
  delete (globalThis as Record<string, unknown>)['window'];
});

test('host too_large error with an id rejects the pending call', async () => {
  installMockIpc();
  const control = createControlClient();
  control.attach();
  const pending = control.call('system.ping', {});
  // The host preserves the request id on oversized/invalid payloads, so
  // the error correlates instead of hanging until timeout.
  hostMessage()(
    JSON.stringify({
      type: 'rpc-response',
      response: { id: sentId(), error: { code: 'too_large', message: 'request too large' } },
    }),
  );
  await expect(pending).rejects.toMatchObject({ code: 'too_large' });
  control.detach();
  delete (globalThis as Record<string, unknown>)['window'];
});

test('call times out and reports a transport error', async () => {
  installMockIpc();
  const control = createControlClient({ timeoutMs: 5 });
  const transportErrors: string[] = [];
  control.onTransportError((message) => transportErrors.push(message));
  control.attach();
  await expect(control.call('system.ping')).rejects.toMatchObject({ code: 'timeout' });
  expect(transportErrors.length).toBe(1);
  control.detach();
  delete (globalThis as Record<string, unknown>)['window'];
});

test('event notifications dispatch by topic only', () => {
  installMockIpc();
  const control = createControlClient();
  control.attach();
  const seen: unknown[] = [];
  const unsubscribe = control.onTopic('points.changed', (data) => seen.push(data));
  const receive = hostMessage();
  receive(
    JSON.stringify({
      method: 'event',
      params: { topic: 'points.changed', data: { uniqueId: 'alice' } },
    }),
  );
  receive(
    JSON.stringify({ method: 'event', params: { topic: 'live.event', data: {} } }),
  );
  expect(seen).toEqual([{ uniqueId: 'alice' }]);
  unsubscribe();
  receive(
    JSON.stringify({
      method: 'event',
      params: { topic: 'points.changed', data: { uniqueId: 'bob' } },
    }),
  );
  expect(seen).toEqual([{ uniqueId: 'alice' }]);
  control.detach();
  delete (globalThis as Record<string, unknown>)['window'];
});

test('gap notifications dispatch to gap handlers with the lost count', () => {
  installMockIpc();
  const control = createControlClient();
  control.attach();
  const seen: number[] = [];
  const topics: unknown[] = [];
  const unsubscribe = control.onGap((lost) => seen.push(lost));
  control.onTopic('points.changed', (data) => topics.push(data));
  const receive = hostMessage();
  // A gap fans out to gap handlers only, never to topic handlers, and
  // later events still arrive afterwards.
  receive(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'event.gap',
      params: { lost: 12, resync: true },
    }),
  );
  expect(seen).toEqual([12]);
  expect(topics).toEqual([]);
  receive(
    JSON.stringify({
      method: 'event',
      params: { topic: 'points.changed', data: { uniqueId: 'alice' } },
    }),
  );
  expect(topics).toEqual([{ uniqueId: 'alice' }]);
  // A malformed gap still forces resync (lost: 0) rather than silently
  // assuming a complete stream.
  receive(JSON.stringify({ method: 'event.gap', params: { resync: true } }));
  expect(seen).toEqual([12, 0]);
  unsubscribe();
  receive(
    JSON.stringify({ method: 'event.gap', params: { lost: 3, resync: true } }),
  );
  expect(seen).toEqual([12, 0]);
  control.detach();
  delete (globalThis as Record<string, unknown>)['window'];
});

test('legacy pushes dispatch by message type', () => {
  installMockIpc();
  const control = createControlClient();
  control.attach();
  const seen: string[] = [];
  control.onPush('leaderboard', () => seen.push('leaderboard'));
  const receive = hostMessage();
  receive(JSON.stringify({ type: 'leaderboard', viewers: [] }));
  receive(JSON.stringify({ type: 'room-stats', viewers: 0, totalUsers: 0, topViewers: [] }));
  expect(seen).toEqual(['leaderboard']);
  control.detach();
  delete (globalThis as Record<string, unknown>)['window'];
});

test('attach drains the queued host messages', async () => {
  installMockIpc();
  const target = (globalThis as Record<string, unknown>)['window'] as Record<string, unknown>;
  target['__tiktools_host_message_queue__'] = [
    JSON.stringify({ type: 'rpc-response', response: { id: 7, result: { ok: true } } }),
  ];
  const control = createControlClient();
  const pending = control.call('system.ping');
  // The queued response arrives during attach; ids will not match, so the
  // call must still be pending afterwards (no crash, no stray resolution).
  control.attach();
  expect(target['__tiktools_host_message_queue__']).toEqual([]);
  control.detach();
  await expect(pending).rejects.toMatchObject({ code: 'transport' });
  delete (globalThis as Record<string, unknown>)['window'];
});

test('detach rejects pending calls', async () => {
  installMockIpc();
  const control = createControlClient();
  control.attach();
  const pending = control.call('system.ping');
  control.detach();
  await expect(pending).rejects.toMatchObject({ code: 'transport' });
  delete (globalThis as Record<string, unknown>)['window'];
});

test('pending RPC admission is bounded and detach releases every slot', async () => {
  const ipc = installMockIpc();
  const control = createControlClient();
  control.attach();
  const outcomes = Array.from({ length: 128 }, () => control.call('system.ping').catch((error: unknown) => error));
  await expect(control.call('system.ping')).rejects.toMatchObject({ code: 'overloaded' });
  expect(ipc.sent).toHaveLength(128);
  expect(control.diagnostics?.()).toMatchObject({ pending: 128, capacity: 128, overloaded: 1, topicCount: 0, topicSubscriptions: 0, pushSubscriptions: 0 });
  control.detach();
  expect(await Promise.all(outcomes)).toHaveLength(128);
  expect(control.diagnostics?.()?.pending).toBe(0);
  await expect(control.call('system.ping')).rejects.toMatchObject({ code: 'transport' });
  delete (globalThis as Record<string, unknown>)['window'];
});


test('a late prior-client response cannot resolve a fresh client request', async () => {
  installMockIpc();
  const old = createControlClient(); old.attach();
  const first = old.call('system.ping').catch(() => undefined);
  const oldId = sentId(); old.detach(); await first;
  const fresh = createControlClient(); fresh.attach();
  const second = fresh.call('system.ping');
  const newId = sentId();
  expect(newId).not.toBe(oldId);
  hostMessage()(JSON.stringify({ type: 'rpc-response', response: { id: oldId, result: 'stale' } }));
  expect(fresh.diagnostics?.().pending).toBe(1);
  hostMessage()(JSON.stringify({ type: 'rpc-response', response: { id: newId, result: 'current' } }));
  await expect(second).resolves.toBe('current');
  fresh.detach(); delete (globalThis as Record<string, unknown>)['window'];
});


test('owner cancellation removes pending RPC admission and ignores a late reply', async () => {
  const mock = installMockIpc();
  const control = createControlClient(); control.attach();
  const owner = new AbortController();
  const pending = control.call('system.ping', {}, { signal: owner.signal });
  const id = sentId(); owner.abort();
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  expect(control.diagnostics?.().pending).toBe(0);
  hostMessage()(JSON.stringify({ type: 'rpc-response', response: { id, result: 'late' } }));
  await expect(control.call('system.ping', {}, { signal: owner.signal })).rejects.toMatchObject({ code: 'cancelled' });
  expect(mock.sent).toHaveLength(1);
  control.detach(); delete (globalThis as Record<string, unknown>)['window'];
});


test('presentation revisions reject messages from a previous view', async () => {
  const ipc = installMockIpc();
  const control = createControlClient();
  control.attach();
  const seen: unknown[] = [];
  control.onTopic('live.ui-event', (data) => seen.push(data));
  const configuring = control.setPresentation?.({ feed: true, points: true, behavior: false, visible: true });
  const first = JSON.parse(ipc.sent.at(-1)!) as { id: string; params: { revision: number } };
  hostMessage()(JSON.stringify({ type: 'rpc-response', response: { id: first.id, result: { version: 1, revision: 1 } } }));
  await configuring;
  const hidden = control.setPresentation?.({ feed: false, points: false, behavior: false, visible: true });
  const second = JSON.parse(ipc.sent.at(-1)!) as { id: string };
  hostMessage()(JSON.stringify({ method: 'event', params: { topic: 'live.ui-event', revision: first.params.revision, data: 'stale' } }));
  expect(seen).toEqual([]);
  hostMessage()(JSON.stringify({ type: 'rpc-response', response: { id: second.id, result: {} } }));
  await hidden;
  control.detach();
});

test('retired-page batches cannot deliver events or legacy pushes to a new generation', async () => {
  const ipc = installMockIpc();
  const control = createControlClient();
  control.attach();
  const events: unknown[] = [];
  const pushes: unknown[] = [];
  control.onTopic('live.ui-event', (data) => events.push(data));
  control.onPush('leaderboard', (data) => pushes.push(data));
  const configuring = control.setPresentation?.({ feed: true, points: true, behavior: false, visible: true });
  hostMessage()(JSON.stringify({ type: 'rpc-response', response: { id: sentId(), result: { generation: 2, revision: 1 } } }));
  await configuring;
  const receive = ((globalThis as Record<string, unknown>)['window'] as Window).__tiktools_receive_batch__!;
  const old = JSON.stringify({ method: 'event', params: { topic: 'live.ui-event', generation: 1, revision: 1, data: 'stale' } });
  receive([old, JSON.stringify({ type: 'leaderboard', viewers: [] })], 1);
  expect(events).toEqual([]);
  expect(pushes).toEqual([]);
  receive([JSON.stringify({ method: 'event', params: { topic: 'live.ui-event', generation: 2, revision: 1, data: 'current' } })], 2);
  expect(events).toEqual(['current']);
  expect(ipc.sent).toHaveLength(1);
  control.detach();
});

test('a fresh page negotiates above a racing old bootstrap revision once', async () => {
  const ipc = installMockIpc();
  const control = createControlClient();
  control.attach();
  const configuring = control.setPresentation?.({ feed: true, points: true, behavior: false, visible: true });
  hostMessage()(JSON.stringify({ type: 'rpc-response', response: { id: sentId(), error: { code: 'stale', message: 'old bootstrap raced', data: { revision: 10, generation: 2 } } } }));
  await Promise.resolve();
  await Promise.resolve();
  expect(ipc.sent).toHaveLength(2);
  expect(JSON.parse(ipc.sent[1]!)).toMatchObject({ params: { revision: 11 } });
  hostMessage()(JSON.stringify({ type: 'rpc-response', response: { id: sentId(), result: { generation: 2, revision: 11 } } }));
  await configuring;
  const ping = control.call('system.ping');
  expect(JSON.parse(ipc.sent.at(-1)!)).toMatchObject({ pageGeneration: 2 });
  hostMessage()(JSON.stringify({ type: 'rpc-response', response: { id: sentId(), result: {} } }));
  await ping;
  control.detach();
});
