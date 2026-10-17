<script setup lang="ts">
import { computed } from 'vue';
import { t, type Locale } from '../i18n.ts';
import type { Theme } from '../preferences.ts';
import type { ConnectionStatus } from '../types.ts';
import { AppIcon } from './app-icon.vue';
import ConnectButton from './connect-button.vue';
import { Tooltip } from './ui/Tooltip.vue';
import {
  IconGlobe,
  IconMoon,
  IconSun,
} from './icons.vue';

type TopNavProps = {
  locale: Locale;
  theme: Theme;
  status: ConnectionStatus;
  activeCreator: string;
  /** Retry attempt reported by the host, when it can observe one. */
  reconnectAttempt?: number | null;
  maxReconnectAttempts?: number;
  onThemeToggle: () => void;
  onLocaleToggle: () => void;
  onConnect: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
};

const props = defineProps<TopNavProps>();

/** Localized status text, including the retry attempt when known. */
const statusLabel = computed(() => {
  switch (props.status) {
    case 'connected':
      return t(props.locale, 'connected');
    case 'connecting':
      return t(props.locale, 'connecting');
    case 'retrying':
      return typeof props.reconnectAttempt === 'number'
        ? t(props.locale, 'reconnectingAttempt', {
            attempt: props.reconnectAttempt,
            max: props.maxReconnectAttempts ?? 5,
          })
        : t(props.locale, 'retrying');
    case 'error':
      return t(props.locale, 'needsAttention');
    case 'disconnected':
      return t(props.locale, 'disconnected');
    default:
      return t(props.locale, 'waiting');
  }
});
</script>

<template>
  <header class="top-nav">
    <div class="brand-section">
      <Tooltip text="TikTok LIVE" position="bottom">
        <div class="brand-logo">
          <AppIcon :size="28" />
        </div>
      </Tooltip>
    </div>

    <div class="top-center">
      <Tooltip v-if="props.activeCreator" :text="statusLabel" position="bottom">
        <div class="active-creator-pill">
          <span :class="['status-dot', props.status === 'connected' ? 'online' : props.status === 'connecting' || props.status === 'retrying' ? 'busy' : 'offline']" />
          <span>@{{ props.activeCreator.replace(/^@/, '') }}</span>
          <span class="active-creator-status" aria-live="polite">{{ statusLabel }}</span>
        </div>
      </Tooltip>
    </div>

    <div class="top-actions">
      <ConnectButton
        :locale="props.locale"
        :status="props.status"
        :reconnect-attempt="props.reconnectAttempt"
        :max-reconnect-attempts="props.maxReconnectAttempts"
        :on-connect="props.onConnect"
        :on-reconnect="props.onReconnect"
        :on-disconnect="props.onDisconnect"
      />

      <Tooltip :text="t(props.locale, 'switchTheme')" position="bottom">
        <button
          class="btn-icon"
          type="button"
          @click="props.onThemeToggle"
        >
          <IconSun v-if="props.theme === 'dark'" />
          <IconMoon v-else />
        </button>
      </Tooltip>

      <Tooltip :text="`${t(props.locale, 'switchLanguage')} (${props.locale.toUpperCase()})`" position="bottom">
        <button
          class="btn-icon"
          type="button"
          :aria-label="`${t(props.locale, 'switchLanguage')} (${props.locale.toUpperCase()})`"
          @click="props.onLocaleToggle"
        >
          <IconGlobe />
        </button>
      </Tooltip>
    </div>
  </header>
</template>
