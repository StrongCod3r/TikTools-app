<script setup lang="ts" generic="T extends string | number">
import { useSplitAttrs } from '@/shared/lib/use-split-attrs.ts';

defineOptions({ inheritAttrs: false });

defineProps<{
  value: T;
  disabled?: boolean;
}>();

const model = defineModel<T>();
const { rootAttrs, controlAttrs } = useSplitAttrs();
</script>

<template>
  <label
    v-bind="rootAttrs"
    class="base-radio"
    :class="{ 'base-radio--disabled': disabled }"
  >
    <input
      v-bind="controlAttrs"
      v-model="model"
      class="base-radio__input"
      type="radio"
      :value="value"
      :disabled="disabled"
    >
    <span
      v-if="$slots.default"
      class="base-radio__label"
    ><slot /></span>
  </label>
</template>

<style scoped>
.base-radio {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--control-height-sm);
  color: var(--color-text);
  font-family: var(--font-family);
  font-size: var(--font-size-md);
  cursor: pointer;
  user-select: none;
}

.base-radio__input {
  appearance: none;
  flex: none;
  width: 14px;
  height: 14px;
  margin: 0;
  border: var(--border-width) solid var(--color-border-strong);
  border-radius: 50%;
  background: var(--color-bg-field);
  cursor: inherit;
  outline: none;
  transition: border-color var(--duration-fast);
}

.base-radio:hover .base-radio__input {
  border-color: var(--color-text-muted);
}

.base-radio__input:checked {
  border-color: var(--color-border-selected);
  background: radial-gradient(circle, var(--color-text-on-accent) 0 2.5px, var(--color-accent) 3px);
}

.base-radio__input:focus-visible {
  border-color: var(--color-border-focus);
  box-shadow: var(--focus-ring);
}

.base-radio--disabled {
  color: var(--color-text-disabled);
  cursor: default;
}

.base-radio--disabled .base-radio__input,
.base-radio--disabled:hover .base-radio__input {
  border-color: var(--color-border);
  background: var(--color-bg-control-active);
}

.base-radio--disabled .base-radio__input:checked {
  background: radial-gradient(circle, var(--color-text-disabled) 0 2.5px, var(--color-bg-control-active) 3px);
}
</style>
