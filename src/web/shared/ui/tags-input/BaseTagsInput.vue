<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import IconClose from '@/shared/ui/icon/icons/IconClose.vue';

defineProps<{
  placeholder?: string;
  disabled?: boolean;
}>();

const model = defineModel<string[]>({ default: () => [] });
const { t } = useI18n();
const draft = ref('');

function commit(): void {
  const value = draft.value.trim();
  draft.value = '';
  if (value && !model.value.includes(value)) model.value = [...model.value, value];
}

function remove(index: number): void {
  model.value = model.value.filter((_, current) => current !== index);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    commit();
  } else if (event.key === 'Backspace' && !draft.value && model.value.length) {
    remove(model.value.length - 1);
  }
}
</script>

<template>
  <span
    class="base-tags-input"
    :class="{ 'base-tags-input--disabled': disabled }"
  >
    <span
      v-for="(tag, index) in model"
      :key="tag"
      class="base-tags-input__tag"
    >
      {{ tag }}
      <button
        class="base-tags-input__remove"
        type="button"
        :aria-label="t('common.removeItem', { item: tag })"
        :disabled="disabled"
        @click="remove(index)"
      >
        <IconClose :size="10" />
      </button>
    </span>
    <input
      v-model="draft"
      class="base-tags-input__input"
      type="text"
      :placeholder="model.length ? undefined : placeholder"
      :disabled="disabled"
      @keydown="onKeydown"
      @blur="commit"
    >
  </span>
</template>

<style scoped>
.base-tags-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-height-md);
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-field);
}

.base-tags-input:focus-within {
  border-color: var(--color-border-focus);
  box-shadow: var(--focus-ring);
}

.base-tags-input--disabled {
  border-color: var(--color-border-subtle);
}

.base-tags-input__tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 20px;
  padding: 0 var(--space-1) 0 var(--space-3);
  border: var(--border-width) solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-bg-control);
  color: var(--color-text);
  font-size: var(--font-size-sm);
}

.base-tags-input__remove {
  display: inline-flex;
  padding: var(--space-1);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transform: none;
}

.base-tags-input__remove:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.base-tags-input__input {
  flex: 1;
  min-width: 80px;
  height: 20px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text);
  font-family: var(--font-family);
  font-size: var(--font-size-md);
  outline: none;
  box-shadow: none;
}
</style>
