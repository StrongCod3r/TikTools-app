<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useLegacyController } from '@/composables/legacy-controller.ts';
import LiveConnectPanel from '@/features/connect-live/ui/LiveConnectPanel.vue';
import LiveExplorerPanel from '@/features/explore-live-rooms/ui/LiveExplorerPanel.vue';
import { debounce, loadViewState, saveViewState } from '@/features/view-state.ts';
import PluginServersPanel from '@/widgets/plugin-servers/ui/PluginServersPanel.vue';

const controller = useLegacyController();
const saved = loadViewState().connections;
const useCookie = ref(saved?.showCookie ?? Boolean(controller.cookie.value));
const expandedServers = ref<Record<string, boolean>>(saved?.openServers ?? {});

const handle = computed({
  get: () => controller.uniqueId.value,
  set: (value: string) => controller.setUniqueId(value),
});

const cookie = computed({
  get: () => controller.cookie.value,
  set: (value: string) => controller.setCookie(value),
});

const persist = debounce(() => {
  saveViewState('connections', { showCookie: useCookie.value, openServers: expandedServers.value });
});
watch([useCookie, expandedServers], persist, { deep: true });
</script>

<template>
  <div class="connections-page">
    <div class="connections-page__top">
      <LiveConnectPanel
        v-model:handle="handle"
        v-model:cookie="cookie"
        v-model:use-cookie="useCookie"
        class="connections-page__live"
        :status="controller.status.value"
        :creator="controller.activeCreator.value"
        :recents="controller.recents.value"
        :error="controller.error.value"
        :reconnect-attempt="controller.reconnectAttempt.value"
        :max-reconnect-attempts="controller.maxReconnectAttempts"
        @connect="controller.handleConnect()"
        @disconnect="controller.handleDisconnect()"
        @reconnect="controller.handleReconnect()"
        @pick-random="controller.handlePickLive()"
        @select-recent="controller.handleSelectRecent"
      />
      <LiveExplorerPanel
        class="connections-page__explorer"
        :current-creator="controller.activeCreator.value"
        @connect="controller.handleConnectRoom"
      />
    </div>
    <PluginServersPanel v-model:expanded="expandedServers" />
  </div>
</template>

<style scoped>
.connections-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  min-height: 0;
  padding: var(--space-4);
  overflow-y: auto;
}

.connections-page__top {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(0, 1.5fr);
  gap: var(--space-4);
  min-height: 360px;
}

@media (width < 1100px) {
  .connections-page__top {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
