<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import IconEye from '@/shared/ui/icon/icons/IconEye.vue';
import IconEyeOff from '@/shared/ui/icon/icons/IconEyeOff.vue';
import { useSplitAttrs } from '@/shared/lib/use-split-attrs.ts';
import type { ControlSize } from '../types.ts';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    type?: 'text' | 'password' | 'search' | 'email' | 'url';
    placeholder?: string;
    size?: ControlSize;
    disabled?: boolean;
    readonly?: boolean;
    invalid?: boolean;
    revealable?: boolean;
  }>(),
  { type: 'text', placeholder: undefined, size: 'md' },
);

const model = defineModel<string>({ default: '' });
const { rootAttrs, controlAttrs } = useSplitAttrs();
const input = useTemplateRef('input');
const { t } = useI18n();
const revealed = ref(false);
const inputType = computed(() => (props.type === 'password' && revealed.value ? 'text' : props.type));

defineExpose({
  focus: () => input.value?.focus(),
  select: () => input.value?.select(),
});
</script>

<template>
  <span
    v-bind="rootAttrs"
    class="base-text-field"
    :class="[`base-text-field--${size}`, { 'base-text-field--invalid': invalid, 'base-text-field--disabled': disabled }]"
  >
    <span
      v-if="$slots.prefix"
      class="base-text-field__adornment"
    ><slot name="prefix" /></span>
    <input
      ref="input"
      v-bind="controlAttrs"
      v-model="model"
      class="base-text-field__input"
      :type="inputType"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :aria-invalid="invalid || undefined"
    >
    <span
      v-if="$slots.suffix"
      class="base-text-field__adornment"
    ><slot name="suffix" /></span>
    <button
      v-if="revealable && type === 'password'"
      class="base-text-field__reveal"
      type="button"
      :aria-label="revealed ? t('common.hideValue') : t('common.showValue')"
      :aria-pressed="revealed"
      :disabled="disabled"
      @click="revealed = !revealed"
    >
      <IconEyeOff v-if="revealed" />
      <IconEye v-else />
    </button>
  </span>
</template>

<style scoped>
.base-text-field {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  height: var(--control-height-md);
  padding: 0 var(--control-padding-x);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-field);
  color: var(--color-text);
  font-family: var(--font-family);
  font-size: var(--font-size-md);
  transition: border-color var(--duration-fast);
}

.base-text-field:hover {
  border-color: var(--color-border-strong);
}

.base-text-field:focus-within {
  border-color: var(--color-border-focus);
  box-shadow: var(--focus-ring);
}

.base-text-field--sm {
  height: var(--control-height-sm);
  font-size: var(--font-size-sm);
}

.base-text-field--invalid,
.base-text-field--invalid:hover {
  border-color: var(--color-danger);
}

.base-text-field--disabled,
.base-text-field--disabled:hover {
  border-color: var(--color-border-subtle);
  color: var(--color-text-disabled);
}

.base-text-field__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  caret-color: var(--color-text);
  outline: none;
  box-shadow: none;
}

.base-text-field__input::placeholder {
  color: var(--color-text-subtle);
}

.base-text-field__input:disabled {
  color: inherit;
  cursor: default;
}

.base-text-field__reveal {
  display: inline-flex;
  flex: none;
  padding: var(--space-1);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transform: none;
}

.base-text-field__reveal:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.base-text-field__adornment {
  display: inline-flex;
  flex: none;
  align-items: center;
  color: var(--color-text-muted);
}
</style>
