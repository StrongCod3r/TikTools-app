import type { Ref } from 'vue';
import type { ActionTypeDefinition, LiveAction, PluginStatus } from '../../automation/behavior/types.ts';
import { useLegacyController } from './legacy-controller.ts';

interface PluginBehavior {
  plugins: PluginStatus[];
  actions: LiveAction[];
  actionTypes: ActionTypeDefinition[];
}

export function useLegacyPlugins() {
  const controller = useLegacyController();
  const behavior = controller.behavior as unknown as Readonly<Ref<PluginBehavior>>;

  return {
    behavior,
    behaviorError: controller.behaviorError,
    settings: controller.pluginSettings,
    connections: controller.pluginConnections,
    provision: controller.pluginProvision,
    actionOptions: controller.actionOptions,
    installState: controller.pluginInstallState,
    openMediaPicker: controller.openMediaPicker,
    loadSettings: controller.handleGetPluginSettings,
    saveSettings: controller.handleSavePluginSettings,
    loadOptions: (source: string) => controller.handleGetActionOptions(source),
    testConnection: controller.handleTestPluginConnection,
    importToken: controller.handleImportPluginToken,
    provisionToken: controller.handleProvisionPluginToken,
    setInstalled: controller.handleSetPluginInstalled,
    setEnabled: controller.handleSetPluginEnabled,
    uninstall: controller.handleUninstallPlugin,
    installPackage: controller.handleInstallPlugin,
    confirmReplace: controller.handleConfirmPluginReplace,
    cancelReplace: controller.handleCancelPluginReplace,
  };
}

export type LegacyPlugins = ReturnType<typeof useLegacyPlugins>;
