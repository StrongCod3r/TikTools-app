import type { HostMessage } from '../../shared/messages.ts';

declare global {
  interface Window {
    ipc?: { postMessage: (message: string) => void };
    __webview_on_message__?: (message: string) => void;
    __tiktools_receive_batch__?: (messages: string[]) => void;
    __tiktools_host_message_queue__?: string[];
  }
}

export type RpcParams = Record<string, unknown>;

export class ControlCallError extends Error {
  readonly code: string;
  readonly data?: unknown;

  constructor(code: string, message: string, data?: unknown) {
    super(message);
    this.name = 'ControlCallError';
    this.code = code;
    this.data = data;
  }
}

/** Human message for a caught RPC failure (ControlCallError or otherwise). */
export function errorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

export type TopicHandler<T = unknown> = (data: T) => void;
export type PushHandler = (message: HostMessage) => void;
export type TransportErrorHandler = (message: string) => void;
/** Reliable-gap signal: `lost` counts the skipped authoritative events. */
export type GapHandler = (lost: number) => void;
export type Unsubscribe = () => void;

type PendingCall = {
  resolve: (result: unknown) => void;
  reject: (error: ControlCallError) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanupAbort: () => void;
};

type RpcResponseWire = {
  id?: number | string | null;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
};

const DEFAULT_TIMEOUT_MS = 150_000;
const MAX_PENDING_CALLS = 128;

/**
 * Byte limit for one serialized WebView RPC request. Must match
 * `MAX_REQUEST_BYTES` in `crates/tiktools-control-api/src/transport.rs`:
 * oversized payloads are rejected here before `postMessage()` so the
 * caller fails fast with `too_large` instead of waiting on a response.
 */
const MAX_WEBVIEW_REQUEST_BYTES = 1024 * 1024;

/** Shared encoder for the request size check: `TextEncoder` is stateless. */
const textEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface ControlClient {
  diagnostics?(): { pending: number; capacity: number; overloaded: number; topicCount?: number; topicSubscriptions?: number; pushSubscriptions?: number };
  attach(): void;
  detach(): void;
  call<T = unknown>(method: string, params?: RpcParams, options?: { signal?: AbortSignal }): Promise<T>;
  onTopic<T = unknown>(topic: string, handler: TopicHandler<T>): Unsubscribe;
  onPush(type: HostMessage['type'], handler: PushHandler): Unsubscribe;
  onTransportError(handler: TransportErrorHandler): Unsubscribe;
  onGap(handler: GapHandler): Unsubscribe;
}

/**
 * The single frontend bridge to the host. Every host round trip goes
 * through `call()` (JSON-RPC over `window.ipc` with request ids, pending
 * promises, and timeouts); every inbound message is routed here into
 * `rpc-response` resolutions, domain-event topic handlers, and legacy
 * host-push handlers. No Vue component or composable touches
 * `window.ipc` directly.
 */
export function createControlClient(options?: { timeoutMs?: number }): ControlClient {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let nextId = 0;
  // Every client/page gets its own namespace. Native generation fencing and
  // unique IDs jointly prevent a queued old-page reply resolving a new call.
  const requestPrefix = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let overloaded = 0;
  let detached = false;
  const pending = new Map<number | string, PendingCall>();
  const topics = new Map<string, Set<TopicHandler<unknown>>>();
  const pushes = new Map<string, Set<PushHandler>>();
  const transportErrors = new Set<TransportErrorHandler>();
  const gaps = new Set<GapHandler>();
  let attachedReceive: ((raw: string) => void) | undefined;

  const reportTransportError = (message: string): void => {
    for (const handler of transportErrors) {
      try {
        handler(message);
      } catch {
        // Listener errors never break dispatch.
      }
    }
  };

  const receive = (raw: string): void => {
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    if (!isRecord(value)) return;
    // JSON-RPC response to call(): { type: 'rpc-response', response: {...} }.
    if (value['type'] === 'rpc-response' && isRecord(value['response'])) {
      const response = value['response'] as RpcResponseWire;
      if (response.id === undefined || response.id === null) return;
      const call = pending.get(response.id);
      if (!call) return;
      pending.delete(response.id);
      clearTimeout(call.timer);
      call.cleanupAbort();
      if (response.error !== undefined && response.error !== null) {
        const code = typeof response.error.code === 'string' ? response.error.code : 'error';
        const message =
          typeof response.error.message === 'string' ? response.error.message : 'request failed';
        call.reject(new ControlCallError(code, message, response.error.data));
      } else {
        call.resolve(response.result ?? null);
      }
      return;
    }
    // Reliable-gap signal: { method: 'event.gap', params: { lost, resync } }.
    // The stream is no longer complete: listeners refresh authoritative
    // state instead of reconstructing the missing events.
    if (value['method'] === 'event.gap' && isRecord(value['params'])) {
      const params = value['params'] as { lost?: unknown };
      const lost = typeof params.lost === 'number' ? params.lost : 0;
      for (const handler of gaps) {
        try {
          handler(lost);
        } catch {
          // Listener errors never break dispatch.
        }
      }
      return;
    }
    // Domain event notification: { method: 'event', params: { topic, data } }.
    if (value['method'] === 'event' && isRecord(value['params'])) {
      const params = value['params'] as { topic?: unknown; data?: unknown };
      if (typeof params.topic !== 'string') return;
      const handlers = topics.get(params.topic);
      if (!handlers) return;
      for (const handler of handlers) {
        try {
          handler(params.data);
        } catch {
          // Listener errors never break dispatch.
        }
      }
      return;
    }
    // Legacy host push, routed by message.type.
    if (typeof value['type'] === 'string') {
      const handlers = pushes.get(value['type']);
      if (!handlers) return;
      const message = value as unknown as HostMessage;
      for (const handler of handlers) {
        try {
          handler(message);
        } catch {
          // Listener errors never break dispatch.
        }
      }
    }
  };

  const receiveBatch = (messages: string[]): void => {
    for (const item of messages) receive(item);
  };

  return {
    diagnostics: () => ({ pending: pending.size, capacity: MAX_PENDING_CALLS, overloaded,
      topicCount: topics.size, topicSubscriptions: [...topics.values()].reduce((total, handlers) => total + handlers.size, 0),
      pushSubscriptions: [...pushes.values()].reduce((total, handlers) => total + handlers.size, 0),
    }),
    attach(): void {
      detached = false;
      attachedReceive = receive;
      window.__webview_on_message__ = receive;
      window.__tiktools_receive_batch__ = receiveBatch;
      const queued = window.__tiktools_host_message_queue__ ?? [];
      window.__tiktools_host_message_queue__ = [];
      queued.forEach(receive);
    },

    detach(): void {
      detached = true;
      if (window.__webview_on_message__ === attachedReceive) {
        window.__webview_on_message__ = undefined;
      }
      if (window.__tiktools_receive_batch__ === receiveBatch) {
        window.__tiktools_receive_batch__ = undefined;
      }
      attachedReceive = undefined;
      topics.clear();
      pushes.clear();
      transportErrors.clear();
      gaps.clear();
      for (const [, call] of pending) {
        clearTimeout(call.timer);
      call.cleanupAbort();
        call.reject(new ControlCallError('transport', 'control client detached'));
      }
      pending.clear();
    },

    call<T = unknown>(method: string, params?: RpcParams, options?: { signal?: AbortSignal }): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const signal = options?.signal;
        if (signal?.aborted) { reject(new ControlCallError('cancelled', 'control request owner disposed')); return; }
        if (detached) {
          reject(new ControlCallError('transport', 'control client detached'));
          return;
        }
        if (pending.size >= MAX_PENDING_CALLS) {
          overloaded += 1;
          const error = new ControlCallError('overloaded', 'control client pending request limit reached');
          reportTransportError(error.message);
          reject(error);
          return;
        }
        if (!window.ipc) {
          reject(new ControlCallError('transport', 'native host is unavailable'));
          return;
        }
        const id = `rpc-${requestPrefix}-${++nextId}`;
        let payload: string;
        try {
          payload = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
        } catch (error) {
          reject(
            new ControlCallError('transport', `could not serialize ${method}: ${String(error)}`),
          );
          return;
        }
        // Fail fast before postMessage: the host enforces the same byte
        // limit, and a rejected-here call never occupies a pending slot.
        if (textEncoder.encode(payload).length > MAX_WEBVIEW_REQUEST_BYTES) {
          const error = new ControlCallError(
            'too_large',
            `request ${method} exceeds the ${MAX_WEBVIEW_REQUEST_BYTES}-byte limit`,
          );
          reportTransportError(error.message);
          reject(error);
          return;
        }
        const onAbort = (): void => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          cleanupAbort();
          reject(new ControlCallError('cancelled', 'control request owner disposed; accepted operation may still complete'));
        };
        const cleanupAbort = (): void => { signal?.removeEventListener('abort', onAbort); };
        const timer = setTimeout(() => {
          pending.delete(id);
          cleanupAbort();
          const error = new ControlCallError('timeout', `request ${method} timed out`);
          reportTransportError(error.message);
          reject(error);
        }, timeoutMs);
        pending.set(id, {
          resolve: (result) => resolve(result as T),
          reject,
          timer,
          cleanupAbort,
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) { onAbort(); return; }
        try {
          window.ipc.postMessage(payload);
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          cleanupAbort();
          reject(new ControlCallError('transport', `could not send ${method}: ${String(error)}`));
        }
      });
    },

    onTopic<T = unknown>(topic: string, handler: TopicHandler<T>): Unsubscribe {
      let handlers = topics.get(topic);
      if (!handlers) {
        handlers = new Set();
        topics.set(topic, handlers);
      }
      const erased = handler as TopicHandler<unknown>;
      handlers.add(erased);
      return () => {
        handlers.delete(erased);
        if (handlers.size === 0 && topics.get(topic) === handlers) topics.delete(topic);
      };
    },

    onPush(type, handler): Unsubscribe {
      let handlers = pushes.get(type);
      if (!handlers) {
        handlers = new Set();
        pushes.set(type, handlers);
      }
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
        if (handlers.size === 0 && pushes.get(type) === handlers) pushes.delete(type);
      };
    },

    onTransportError(handler): Unsubscribe {
      transportErrors.add(handler);
      return () => {
        transportErrors.delete(handler);
      };
    },

    onGap(handler): Unsubscribe {
      gaps.add(handler);
      return () => {
        gaps.delete(handler);
      };
    },
  };
}

/**
 * Boot handshake posted once Vue has mounted. The native window stays
 * hidden until the host observes this, so a missing bridge fails loudly
 * instead of timing out with no frontend diagnostic.
 */
export function notifyFrontendReady(): void {
  if (!window.ipc) {
    throw new Error('TikTools native IPC bridge is unavailable during frontend startup');
  }
  window.ipc.postMessage(JSON.stringify({ type: 'frontend-ready' }));
}
