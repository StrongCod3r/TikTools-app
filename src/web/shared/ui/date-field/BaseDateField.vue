<script setup lang="ts">
import type { ControlSize } from '../types.ts';

withDefaults(
  defineProps<{
    type?: 'date' | 'time' | 'datetime-local';
    min?: string;
    max?: string;
    size?: ControlSize;
    disabled?: boolean;
  }>(),
  { type: 'date', min: undefined, max: undefined, size: 'md' },
);

const model = defineModel<string>({ default: '' });
</script>

<template>
  <input
    v-model="model"
    class="base-date-field"
    :class="`base-date-field--${size}`"
    :type="type"
    :min="min"
    :max="max"
    :disabled="disabled"
  >
</template>

<style scoped>
.base-date-field {
  height: var(--control-height-md);
  padding: 0 var(--control-padding-x);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-field);
  color: var(--color-text);
  color-scheme: dark;
  font-family: var(--font-family);
  font-size: var(--font-size-md);
  font-variant-numeric: tabular-nums;
  outline: none;
  box-shadow: none;
}

.base-date-field:hover {
  border-color: var(--color-border-strong);
}

.base-date-field:focus {
  border-color: var(--color-border-focus);
  box-shadow: var(--focus-ring);
}

.base-date-field--sm {
  height: var(--control-height-sm);
  font-size: var(--font-size-sm);
}

.base-date-field:disabled {
  border-color: var(--color-border-subtle);
  color: var(--color-text-disabled);
}
</style>
