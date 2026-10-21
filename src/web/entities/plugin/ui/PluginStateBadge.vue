<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { PluginState } from '../lib/plugin-catalog.ts';

defineProps<{
  state: PluginState;
}>();

const { t } = useI18n();
</script>

<template>
  <span
    class="plugin-state"
    :class="`plugin-state--${state}`"
  >
    <span
      class="plugin-state__dot"
      aria-hidden="true"
    />
    {{ t(`plugins.state.${state}`) }}
  </span>
</template>

<style scoped>
.plugin-state {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-subtle);
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.plugin-state__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-text-subtle);
}

.plugin-state--active {
  color: var(--color-success);
}

.plugin-state--active .plugin-state__dot {
  background: var(--color-success);
}

.plugin-state--disabled .plugin-state__dot {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--color-text-subtle);
}

.plugin-state--unavailable {
  color: var(--color-warning);
}

.plugin-state--unavailable .plugin-state__dot {
  background: var(--color-warning);
}
</style>
