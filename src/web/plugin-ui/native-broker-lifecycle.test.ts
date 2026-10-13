import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function harness() {
  const source = readFileSync(new URL('../../../crates/tiktools-desktop/src/plugin_webview/mod.rs', import.meta.url), 'utf8');
  const script = source.split('const INIT_SCRIPT: &str = r#"')[1]?.split('"#;')[0];
  if (!script) throw new Error('native broker initialization script missing');
  const timers = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  const requests: Array<{ id: string }> = [];
  let sequence = 0;
  const window = {
    ipc: { postMessage: (text: string) => { requests.push(JSON.parse(text)); } },
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  } as unknown as Window & {
    tiktools: { settings: { get(): Promise<unknown> } };
    __tiktools_broker_push__: (value: unknown) => void;
    __tiktools_broker_dispose__: () => void;
  };
  runInNewContext(script, {
    window,
    setTimeout: (callback: () => void) => { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  return { window, timers, listeners, requests };
}

test('native broker times out requests and ignores late responses', async () => {
  const { window, timers, requests } = harness();
  const pending = window.tiktools.settings.get().catch((error: Error) => error.message);
  const [id, timeout] = [...timers.entries()][0]!;
  timers.delete(id);
  timeout();
  expect(await pending).toContain('timed out');
  window.__tiktools_broker_push__({ apiVersion: 1, id: requests[0]!.id, ok: true, result: {} });
  expect(timers.size).toBe(0);
  window.__tiktools_broker_dispose__();
});

test('native broker bounds admission and rejects all pending requests on teardown', async () => {
  const { window, timers, listeners, requests } = harness();
  const pending = Array.from({ length: 128 }, () => window.tiktools.settings.get().catch((error: Error) => error.message));
  const overflow = await window.tiktools.settings.get().catch((error: Error) => error.message);
  expect(overflow).toContain('limit');
  expect(requests.length).toBe(128);
  expect(timers.size).toBe(128);
  listeners.get('pagehide')!();
  expect((await Promise.all(pending)).every((result) => String(result).includes('closed'))).toBe(true);
  expect(timers.size).toBe(0);
  expect(listeners.size).toBe(0);
  window.__tiktools_broker_dispose__();
  expect(await window.tiktools.settings.get().catch((error: Error) => error.message)).toContain('closed');
});
