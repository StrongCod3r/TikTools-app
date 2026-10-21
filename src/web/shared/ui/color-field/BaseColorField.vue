<script setup lang="ts">
import { ref, watch } from 'vue';
import { useSplitAttrs } from '@/shared/lib/use-split-attrs.ts';

defineOptions({ inheritAttrs: false });

defineProps<{
  disabled?: boolean;
}>();

const model = defineModel<string>({ default: '#000000' });
const { rootAttrs, controlAttrs } = useSplitAttrs();
const text = ref(model.value);

watch(model, (value) => {
  text.value = value;
});

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function commitText(): void {
  const value = text.value.trim();
  if (HEX.test(value)) model.value = value.toLowerCase();
  else text.value = model.value;
}
</script>

<template>
  <span
    v-bind="rootAttrs"
    class="base-color-field"
    :class="{ 'base-color-field--disabled': disabled }"
  >
    <input
      v-model="model"
      class="base-color-field__swatch"
      type="color"
      :disabled="disabled"
      tabindex="-1"
      aria-hidden="true"
    >
    <input
      v-bind="controlAttrs"
      v-model="text"
      class="base-color-field__text"
      type="text"
      spellcheck="false"
      :disabled="disabled"
      @blur="commitText"
      @keydown.enter.prevent="commitText"
    >
  </span>
</template>

<style scoped>
.base-color-field {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-height-md);
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-field);
}

.base-color-field:focus-within {
  border-color: var(--color-border-focus);
  box-shadow: var(--focus-ring);
}

.base-color-field--disabled {
  border-color: var(--color-border-subtle);
}

.base-color-field__swatch {
  width: 20px;
  height: 18px;
  padding: 0;
  border: var(--border-width) solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
}

.base-color-field__text {
  width: 80px;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
  outline: none;
  box-shadow: none;
}
</style>
