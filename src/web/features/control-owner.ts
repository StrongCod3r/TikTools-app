import type { ControlClient } from '../platform/control-client.ts';

/** A feature owns its subscriptions independently of the shared client. */
export function ownControlSubscriptions(control: ControlClient) {
  const listeners: Array<() => void> = [];
  let disposed = false;
  const client: ControlClient = {
    ...control,
    onTopic<T = unknown>(topic: string, handler: (data: T) => void) {
      const off = control.onTopic<T>(topic, (data) => { if (!disposed) handler(data); });
      listeners.push(off);
      return off;
    },
    onPush(type, handler) {
      const off = control.onPush(type, (message) => { if (!disposed) handler(message); });
      listeners.push(off);
      return off;
    },
  };
  return {
    client,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of listeners.splice(0)) off();
    },
  };
}
