<script setup lang="ts">
import { computed, reactive, type ComputedRef } from 'vue';
import { useRoute } from 'vue-router';
import type { PluginPageDescriptor, PluginStatus } from '../../../../automation/behavior/types.ts';
import { useLegacyController } from '@/composables/legacy-controller.ts';
import { i18nText } from '@/i18n.ts';
import PluginPageView from '@/views/plugin-page-view.vue';

const controller = useLegacyController();
const app = reactive(controller);
const route = useRoute();

const page: ComputedRef<PluginPageDescriptor | undefined> = computed(() => {
  const pages: PluginPageDescriptor[] = controller.pluginPages.value;
  return pages.find((entry) => entry.pluginId === route.params.pluginId && entry.id === route.params.pageId);
});
const plugin: ComputedRef<PluginStatus | undefined> = computed(() => {
  const plugins: PluginStatus[] = controller.behavior.value.plugins;
  return plugins.find((entry) => entry.descriptor.id === page.value?.pluginId);
});
const pluginName = computed(() =>
  plugin.value ? i18nText(controller.locale.value, plugin.value.descriptor.name) : (page.value?.pluginId ?? ''),
);
const pluginUi = computed(() => controller.pluginUis.value.find((entry) => entry.pluginId === page.value?.pluginId));
const pluginBackend = computed(() => (page.value ? controller.createPluginBackend(page.value.pluginId) : undefined));
</script>

<template>
  <PluginPageView
    v-if="page"
    :key="`${page.pluginId}:${page.id}`"
    :locale="app.locale"
    :page="page"
    :plugin-name="pluginName"
    :settings-state="app.pluginSettings[page.pluginId]"
    :connection="app.pluginConnections[page.pluginId]"
    :action-options="app.actionOptions"
    :action-option-errors="app.actionOptionErrors"
    :action-option-selected="app.actionOptionSelected"
    :on-get-settings="app.handleGetPluginSettings"
    :on-save-settings="app.handleSavePluginSettings"
    :on-get-action-options="app.handleGetActionOptions"
    :on-test-connection="app.handleTestPluginConnection"
    :on-open-media-picker="app.openMediaPicker"
    :on-execute-action="(actionType, config) => app.executePluginAction(page?.pluginId ?? '', actionType, config, true)"
    :supports-provisioning="plugin?.descriptor.supportsTokenProvisioning ?? false"
    :supports-token-import="plugin?.descriptor.supportsTokenImport ?? false"
    :supports-token-discovery="plugin?.descriptor.supportsTokenDiscovery ?? false"
    :provision-state="app.pluginProvision[page.pluginId]"
    :on-provision-token="app.handleProvisionPluginToken"
    :on-import-token="app.handleImportPluginToken"
    :ui="pluginUi"
    :backend="pluginBackend?.backend"
    :subscribe-topic="pluginBackend?.subscribeTopic"
  />
</template>
