<script setup lang="ts">
import { computed, markRaw, provide, reactive, watch, type Component } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import type { PluginPageDescriptor } from '../../../automation/behavior/types.ts';
import { isConnectionOnlyPage, pluginNavId } from '../../../automation/plugins/declarative.ts';
import PluginProgressNotification from '@/components/plugin-progress-notification.vue';
import DialogHost from '@/components/ui/dialog-host.vue';
import { legacyControllerKey } from '@/composables/legacy-controller.ts';
import { useAppController } from '@/composables/useAppController.ts';
import { i18nText } from '@/i18n.ts';
import IconChart from '@/shared/ui/icon/icons/IconChart.vue';
import IconChat from '@/shared/ui/icon/icons/IconChat.vue';
import IconCoins from '@/shared/ui/icon/icons/IconCoins.vue';
import IconFlow from '@/shared/ui/icon/icons/IconFlow.vue';
import IconGear from '@/shared/ui/icon/icons/IconGear.vue';
import IconLayers from '@/shared/ui/icon/icons/IconLayers.vue';
import IconLink from '@/shared/ui/icon/icons/IconLink.vue';
import IconPuzzle from '@/shared/ui/icon/icons/IconPuzzle.vue';
import type { AppTab, BuiltinAppTab } from '@/types.ts';
import AppMenuBar from '@/widgets/app-menu-bar/ui/AppMenuBar.vue';
import type { NavigationItem, NavigationSection } from '@/widgets/app-navigation/model/navigation-types.ts';
import AppNavigation from '@/widgets/app-navigation/ui/AppNavigation.vue';
import AppStatusBar from '@/widgets/app-status-bar/ui/AppStatusBar.vue';
import { tabFromRoute, tabLocation } from '../router/tab-routes.ts';

const controller = useAppController();
provide(legacyControllerKey, controller);
controller.setTheme('dark');

const app = reactive(controller);
const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const builtinPages: ReadonlyArray<{ tab: BuiltinAppTab; label: string; icon: Component }> = [
  { tab: 'feed', label: 'navigation.feed', icon: IconChat },
  { tab: 'points', label: 'navigation.points', icon: IconCoins },
  { tab: 'analytics', label: 'navigation.analytics', icon: IconChart },
  { tab: 'connect', label: 'navigation.connections', icon: IconLink },
  { tab: 'behavior', label: 'navigation.automations', icon: IconFlow },
  { tab: 'plugins', label: 'navigation.plugins', icon: IconPuzzle },
  { tab: 'widgets', label: 'navigation.overlays', icon: IconLayers },
  { tab: 'settings', label: 'navigation.settings', icon: IconGear },
];

const builtinItems = computed<NavigationItem[]>(() =>
  builtinPages.map((page) => ({
    id: page.tab,
    label: t(page.label),
    icon: markRaw(page.icon),
    to: tabLocation(page.tab),
  })),
);

const pluginItems = computed<NavigationItem[]>(() => {
  const pages: PluginPageDescriptor[] = controller.pluginPages.value;
  return pages
    .filter((page) => !isConnectionOnlyPage(page))
    .map((page) => {
      const tab = pluginNavId(page.pluginId, page.id);
      return {
        id: tab,
        label: i18nText(controller.locale.value, page.title),
        icon: markRaw(IconPuzzle),
        to: tabLocation(tab),
      };
    });
});

const sections = computed<NavigationSection[]>(() => [
  { id: 'workspace', label: t('navigation.sections.workspace'), items: builtinItems.value },
  ...(pluginItems.value.length
    ? [{ id: 'plugins', label: t('navigation.sections.plugins'), items: pluginItems.value }]
    : []),
]);

const menuPages = computed(() => sections.value.flatMap((section) => section.items));

const routeTab = computed(() => tabFromRoute(route));

watch(
  routeTab,
  (tab) => {
    if (tab && tab !== controller.activeTab.value) controller.setActiveTab(tab);
  },
  { immediate: true },
);

watch(controller.activeTab, (tab) => {
  if (tab !== routeTab.value) void router.push(tabLocation(tab));
});

function navigate(tab: string): void {
  void router.push(tabLocation(tab as AppTab));
}

function connect(): void {
  if (controller.uniqueId.value || controller.activeCreator.value) controller.handleConnect();
  else navigate('connect');
}
</script>

<template>
  <div class="app-layout">
    <DialogHost :locale="app.locale" />
    <PluginProgressNotification
      v-if="app.pluginProgress"
      :notification="app.pluginProgress"
      :on-dismiss="app.dismissPluginProgress"
    />
    <AppMenuBar
      :status="app.status"
      :locale="app.locale"
      :pages="menuPages"
      @connect="connect"
      @disconnect="app.handleDisconnect"
      @reconnect="app.handleReconnect"
      @navigate="navigate"
      @change-locale="app.setLocale"
    />
    <div class="app-layout__body">
      <AppNavigation
        class="app-layout__navigation"
        :sections="sections"
      />
      <main class="app-layout__content">
        <RouterView />
      </main>
    </div>
    <AppStatusBar
      :status="app.status"
      :creator="app.activeCreator"
      :viewers="app.liveViewers"
      :reconnect-attempt="app.reconnectAttempt"
      :max-reconnect-attempts="app.maxReconnectAttempts"
      @connect="connect"
      @disconnect="app.handleDisconnect"
      @reconnect="app.handleReconnect"
    />
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--color-bg-app);
  color: var(--color-text);
  font-family: var(--font-family);
  font-size: var(--font-size-md);
}

.app-layout__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.app-layout__navigation {
  flex: none;
  width: 208px;
  border-right: var(--border-width) solid var(--color-border-subtle);
}

.app-layout__content {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
