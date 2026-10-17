<script setup lang="ts">
import { computed } from 'vue';
import { t, type Locale } from '../i18n.ts';
import type { ConnectionStatus } from '../types.ts';
import { Tooltip } from './ui/Tooltip.vue';
import {
  IconConnected,
  IconDisconnected,
  IconRefresh,
} from './icons.vue';

type ConnectButtonProps = {
  locale: Locale;
  status: ConnectionStatus;
  /** Retry attempt reported by the host, when it can observe one. */
  reconnectAttempt?: number | null;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
};

const props = defineProps<ConnectButtonProps>();

const busyLabel = computed(() => {
  if (props.status !== 'retrying') return `${t(props.locale, 'connecting')}…`;
  if (typeof props.reconnectAttempt === 'number') {
    return t(props.locale, 'reconnectingAttempt', {
      attempt: props.reconnectAttempt,
      max: props.maxReconnectAttempts ?? 5,
    });
  }
  return `${t(props.locale, 'retrying')}…`;
});

const busyTitle = computed(() => {
  if (props.status !== 'retrying' || typeof props.reconnectDelayMs !== 'number') return undefined;
  return t(props.locale, 'reconnectInSeconds', {
    seconds: Math.max(1, Math.round(props.reconnectDelayMs / 1000)),
  });
});
</script>

<template>
  <div class="connect-control">
    <!-- Connected: explicit disconnect + reconnect -->
    <template v-if="props.status === 'connected'">
      <Tooltip :text="t(props.locale, 'reconnect')" position="bottom">
        <button class="btn-icon" type="button" @click="props.onReconnect" :aria-label="t(props.locale, 'reconnect')">
          <IconRefresh />
        </button>
      </Tooltip>
      <Tooltip :text="t(props.locale, 'disconnect')" position="bottom">
        <button class="ui-btn ui-btn--danger ui-btn--sm connect-btn" type="button" @click="props.onDisconnect">
          <IconDisconnected :size="14" />
          <span>{{ t(props.locale, 'disconnect') }}</span>
        </button>
      </Tooltip>
    </template>

    <!-- Busy: disabled stateful button -->
    <template v-else-if="props.status === 'connecting' || props.status === 'retrying'">
      <button
        class="ui-btn ui-btn--soft ui-btn--sm connect-btn is-busy"
        type="button"
        :title="busyTitle"
        aria-live="polite"
        disabled
      >
        <span class="connect-spinner" aria-hidden="true" />
        <span>{{ busyLabel }}</span>
      </button>
    </template>

    <!-- Error: explicit retry -->
    <template v-else-if="props.status === 'error'">
      <Tooltip :text="t(props.locale, 'needsAttention')" position="bottom">
        <button class="ui-btn ui-btn--primary ui-btn--sm connect-btn" type="button" @click="props.onReconnect">
          <IconRefresh :size="14" />
          <span>{{ t(props.locale, 'reconnect') }}</span>
        </button>
      </Tooltip>
    </template>

    <!-- Offline / idle / disconnected: primary connect CTA -->
    <template v-else>
      <Tooltip :text="t(props.locale, 'connectToLive')" position="bottom">
        <button class="ui-btn ui-btn--cyan ui-btn--sm connect-btn" type="button" @click="props.onConnect">
          <IconConnected :size="14" />
          <span>{{ t(props.locale, 'connect') }}</span>
        </button>
      </Tooltip>
    </template>
  </div>
</template>
