import { inject, type InjectionKey } from 'vue';
import type { ControlClient } from './control-client.ts';

export const controlClientKey: InjectionKey<ControlClient> = Symbol('control-client');

export function useControlClient(): ControlClient {
  const client = inject(controlClientKey);
  if (!client) throw new Error('ControlClient is not provided');
  return client;
}
