import type { PluginStatus } from '../../../../automation/behavior/types.ts';
import type { PluginConnectionState } from '../../../../automation/plugins/declarative.ts';

export interface ServerEntry {
  plugin: PluginStatus;
  id: string;
  name: string;
  connection: PluginConnectionState | undefined;
}

export function serverEntries(
  plugins: readonly PluginStatus[],
  connections: Readonly<Record<string, PluginConnectionState | undefined>>,
  nameOf: (plugin: PluginStatus) => string,
): ServerEntry[] {
  return plugins
    .filter((plugin) => plugin.installed && plugin.enabled && plugin.descriptor.hasConnectionProbe)
    .map((plugin) => ({
      plugin,
      id: plugin.descriptor.id,
      name: nameOf(plugin),
      connection: connections[plugin.descriptor.id],
    }));
}
