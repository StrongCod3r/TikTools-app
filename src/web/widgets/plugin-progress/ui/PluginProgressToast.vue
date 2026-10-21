<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { HostMessage } from '../../../../shared/messages.ts';
import BaseIconButton from '@/shared/ui/button/BaseIconButton.vue';
import IconClose from '@/shared/ui/icon/icons/IconClose.vue';

type PluginProgress = Extract<HostMessage, { type: 'plugin-progress' }>;

const props = defineProps<{
  progress: PluginProgress;
}>();

const emit = defineEmits<{ dismiss: [] }>();
const { t } = useI18n();

const percent = computed(() =>
  props.progress.progress === undefined ? undefined : Math.round(Math.max(0, Math.min(1, props.progress.progress)) * 100),
);
</script>

<template>
  <aside
    class="plugin-progress"
    :class="`plugin-progress--${progress.state}`"
    role="status"
    aria-live="polite"
  >
    <header class="plugin-progress__head">
      <strong>{{ progress.pluginId }}</strong>
      <span class="plugin-progress__state">{{ t(`plugins.progress.${progress.state}`) }}</span>
      <span
        v-if="percent !== undefined"
        class="plugin-progress__percent"
      >{{ percent }}%</span>
      <BaseIconButton
        :label="t('common.close')"
        size="sm"
        @click="emit('dismiss')"
      >
        <IconClose />
      </BaseIconButton>
    </header>
    <p class="plugin-progress__message">
      {{ progress.message }}
    </p>
    <div
      class="plugin-progress__track"
      :class="{ 'plugin-progress__track--indeterminate': percent === undefined }"
    >
      <div
        class="plugin-progress__bar"
        :style="percent === undefined ? undefined : { width: `${percent}%` }"
      />
    </div>
  </aside>
</template>

<style scoped>
.plugin-progress {
  position: fixed;
  right: var(--space-5);
  bottom: 40px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: min(340px, calc(100vw - 32px));
  padding: var(--space-4);
  border: var(--border-width) solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-bg-raised);
  color: var(--color-text);
  font-family: var(--font-family);
  font-size: var(--font-size-md);
}

.plugin-progress--failed {
  border-color: var(--color-danger);
}

.plugin-progress__head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.plugin-progress__head strong {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-progress__state,
.plugin-progress__percent {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.plugin-progress__message {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.plugin-progress__track {
  position: relative;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--color-bg-control);
}

.plugin-progress__bar {
  height: 100%;
  background: var(--color-accent);
}

.plugin-progress--failed .plugin-progress__bar {
  background: var(--color-danger);
}

.plugin-progress--ready .plugin-progress__bar {
  background: var(--color-success);
}

.plugin-progress__track--indeterminate .plugin-progress__bar {
  position: absolute;
  width: 30%;
  animation: plugin-progress-slide 1.2s ease-in-out infinite;
}

@keyframes plugin-progress-slide {
  from {
    left: -30%;
  }

  to {
    left: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .plugin-progress__track--indeterminate .plugin-progress__bar {
    left: 0;
    width: 100%;
    animation: none;
    opacity: 0.6;
  }
}
</style>
