<script setup lang="ts">
import { useTemplateRef } from 'vue';

withDefaults(
  defineProps<{
    rows?: number;
    placeholder?: string;
    maxLength?: number;
    monospace?: boolean;
    disabled?: boolean;
    readonly?: boolean;
    invalid?: boolean;
  }>(),
  { rows: 4, placeholder: undefined, maxLength: undefined },
);

const model = defineModel<string>({ default: '' });
const area = useTemplateRef('area');

defineExpose({ focus: () => area.value?.focus() });
</script>

<template>
  <span
    class="base-text-area"
    :class="{ 'base-text-area--invalid': invalid, 'base-text-area--disabled': disabled }"
  >
    <textarea
      ref="area"
      v-model="model"
      class="base-text-area__input"
      :class="{ 'base-text-area__input--mono': monospace }"
      :rows="rows"
      :placeholder="placeholder"
      :maxlength="maxLength"
      :disabled="disabled"
      :readonly="readonly"
      :aria-invalid="invalid || undefined"
      :spellcheck="!monospace"
    />
    <span
      v-if="maxLength"
      class="base-text-area__count"
    >{{ model.length }} / {{ maxLength }}</span>
  </span>
</template>

<style scoped>
.base-text-area {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-field);
}

.base-text-area:hover {
  border-color: var(--color-border-strong);
}

.base-text-area:focus-within {
  border-color: var(--color-border-focus);
  box-shadow: var(--focus-ring);
}

.base-text-area--invalid,
.base-text-area--invalid:hover {
  border-color: var(--color-danger);
}

.base-text-area--disabled,
.base-text-area--disabled:hover {
  border-color: var(--color-border-subtle);
}

.base-text-area__input {
  min-height: 0;
  padding: var(--space-3) var(--control-padding-x);
  border: 0;
  background: transparent;
  color: var(--color-text);
  font-family: var(--font-family);
  font-size: var(--font-size-md);
  line-height: var(--line-height-normal);
  caret-color: var(--color-text);
  resize: vertical;
  outline: none;
  box-shadow: none;
}

.base-text-area__input--mono {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
}

.base-text-area__input:disabled {
  color: var(--color-text-disabled);
}

.base-text-area__count {
  align-self: flex-end;
  padding: 0 var(--space-3) var(--space-2);
  color: var(--color-text-subtle);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}
</style>
