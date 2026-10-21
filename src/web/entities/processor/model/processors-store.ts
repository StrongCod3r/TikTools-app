import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { AutomationEvent, JsonObject } from '../../../../automation/types.ts';
import type { ProcessorStatusEntry } from '../../../../shared/messages.ts';
import { errorMessage } from '@/shared/api/control-client.ts';
import { useControlClient } from '@/shared/api/use-control-client.ts';

export interface ProcessorTestOutcome {
  pluginId: string;
  processorId: string;
  ok: boolean;
  durationMs: number;
  result: JsonObject;
  error?: string;
}

export const useProcessorsStore = defineStore('processors', () => {
  const client = useControlClient();
  const processors = shallowRef<ProcessorStatusEntry[]>([]);
  const test = ref<ProcessorTestOutcome | null>(null);
  const testing = ref<string | null>(null);
  const error = ref<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      const result = await client.call<{ processors: ProcessorStatusEntry[] }>('processors.status', {});
      processors.value = result.processors;
      error.value = null;
    } catch (failure) {
      error.value = errorMessage(failure);
    }
  }

  async function runTest(pluginId: string, processorId: string, event: AutomationEvent): Promise<void> {
    test.value = null;
    testing.value = `${pluginId}/${processorId}`;
    try {
      const result = await client.call<ProcessorTestOutcome & { error?: string | null }>('processors.test', {
        pluginId,
        processorId,
        event,
      });
      test.value = { ...result, error: result.error ?? undefined };
      void refresh();
    } catch (failure) {
      test.value = { pluginId, processorId, ok: false, durationMs: 0, result: {}, error: errorMessage(failure) };
    } finally {
      testing.value = null;
    }
  }

  return { processors, test, testing, error, refresh, runTest };
});
