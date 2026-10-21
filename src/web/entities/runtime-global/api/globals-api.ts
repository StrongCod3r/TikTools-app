import type { ControlClient } from '@/shared/api/control-client.ts';

function asGlobalsMap(result: unknown): Record<string, string> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};
  const raw = (result as { globals?: unknown }).globals;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export async function listGlobals(client: ControlClient): Promise<Record<string, string>> {
  return asGlobalsMap(await client.call('globals.list', {}));
}

export async function setGlobal(client: ControlClient, key: string, value: string): Promise<void> {
  await client.call('globals.set', { key, value });
}

export async function deleteGlobal(client: ControlClient, key: string): Promise<void> {
  await client.call('globals.delete', { key });
}
