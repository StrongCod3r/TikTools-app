export type PluginDetailsTab = 'general' | 'settings' | 'connection';

export const pluginDetailsTabs: readonly PluginDetailsTab[] = ['general', 'settings', 'connection'];

export function isPluginDetailsTab(value: unknown): value is PluginDetailsTab {
  return typeof value === 'string' && (pluginDetailsTabs as readonly string[]).includes(value);
}
