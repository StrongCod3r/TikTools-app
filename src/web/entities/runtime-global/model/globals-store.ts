import { defineStore } from 'pinia';
import { ref } from 'vue';
import { errorMessage } from '@/shared/api/control-client.ts';
import { useControlClient } from '@/shared/api/use-control-client.ts';
import { deleteGlobal, listGlobals, setGlobal } from '../api/globals-api.ts';
import { sortedGlobalEntries } from '../lib/global-key.ts';

export const useGlobalsStore = defineStore('runtime-globals', () => {
  const client = useControlClient();
  const globals = ref<Record<string, string>>({});
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      globals.value = await listGlobals(client);
    } catch (failure) {
      error.value = errorMessage(failure);
    } finally {
      loading.value = false;
    }
  }

  async function save(next: Record<string, string>): Promise<void> {
    error.value = null;
    const current = globals.value;
    const deletions = Object.keys(current)
      .filter((key) => !Object.hasOwn(next, key))
      .sort();
    const writes = sortedGlobalEntries(next).filter(([key, value]) => current[key] !== value);
    try {
      for (const key of deletions) await deleteGlobal(client, key);
      for (const [key, value] of writes) await setGlobal(client, key, value);
      globals.value = { ...next };
    } catch (failure) {
      const message = errorMessage(failure);
      await load();
      error.value = message;
      throw failure;
    }
  }

  return { globals, loading, error, load, save };
});
