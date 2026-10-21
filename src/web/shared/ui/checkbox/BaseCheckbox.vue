<script setup lang="ts">
import IconCheck from '@/shared/ui/icon/icons/IconCheck.vue';
import IconMinus from '@/shared/ui/icon/icons/IconMinus.vue';
import { useSplitAttrs } from '@/shared/lib/use-split-attrs.ts';

defineOptions({ inheritAttrs: false });

defineProps<{
  disabled?: boolean;
  indeterminate?: boolean;
}>();

const model = defineModel<boolean>({ default: false });
const { rootAttrs, controlAttrs } = useSplitAttrs();
</script>

<template>
  <label
    v-bind="rootAttrs"
    class="base-checkbox"
    :class="{ 'base-checkbox--disabled': disabled }"
  >
    <span class="base-checkbox__box">
      <input
        v-bind="controlAttrs"
        v-model="model"
        class="base-checkbox__input"
        type="checkbox"
        :disabled="disabled"
        :indeterminate="indeterminate"
      >
      <IconMinus
        v-if="indeterminate"
        class="base-checkbox__mark"
        :size="12"
      />
      <IconCheck
        v-else-if="model"
        class="base-checkbox__mark"
        :size="12"
      />
    </span>
    <span
      v-if="$slots.default"
      class="base-checkbox__label"
    ><slot /></span>
  </label>
</template>

<style scoped>
.base-checkbox {
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

.base-checkbox__box {
  position: relative;
  display: inline-flex;
  flex: none;
  width: 14px;
  height: 14px;
}

.base-checkbox__input {
  appearance: none;
  width: 100%;
  height: 100%;
  margin: 0;
  border: var(--border-width) solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-bg-field);
  cursor: inherit;
  outline: none;
  transition:
    background-color var(--duration-fast),
    border-color var(--duration-fast);
}

.base-checkbox:hover .base-checkbox__input {
  border-color: var(--color-text-muted);
}

.base-checkbox__input:checked,
.base-checkbox__input:indeterminate {
  border-color: var(--color-border-selected);
  background: var(--color-accent);
}

.base-checkbox__input:focus-visible {
  border-color: var(--color-border-focus);
  box-shadow: var(--focus-ring);
}

.base-checkbox__mark {
  position: absolute;
  inset: 1px;
  color: var(--color-text-on-accent);
  pointer-events: none;
}

.base-checkbox--disabled {
  color: var(--color-text-disabled);
  cursor: default;
}

.base-checkbox--disabled .base-checkbox__input,
.base-checkbox--disabled:hover .base-checkbox__input {
  border-color: var(--color-border);
  background: var(--color-bg-control-active);
}

.base-checkbox--disabled .base-checkbox__mark {
  color: var(--color-text-disabled);
}
</style>
