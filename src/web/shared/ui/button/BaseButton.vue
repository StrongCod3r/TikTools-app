<script setup lang="ts">
import type { ControlSize } from '../types.ts';

withDefaults(
  defineProps<{
    variant?: 'default' | 'primary' | 'danger' | 'ghost';
    size?: ControlSize;
    type?: 'button' | 'submit' | 'reset';
    block?: boolean;
    disabled?: boolean;
    pressed?: boolean;
  }>(),
  { variant: 'default', size: 'md', type: 'button', pressed: undefined },
);
</script>

<template>
  <button
    class="base-button"
    :class="[`base-button--${variant}`, `base-button--${size}`, { 'base-button--block': block }]"
    :type="type"
    :disabled="disabled"
    :aria-pressed="pressed"
  >
    <slot name="icon" />
    <span
      v-if="$slots.default"
      class="base-button__label"
    ><slot /></span>
  </button>
</template>

<style scoped>
.base-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-width: 0;
  height: var(--control-height-md);
  padding: 0 var(--space-5);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-control);
  color: var(--color-text);
  font-family: var(--font-family);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-regular);
  line-height: var(--line-height-tight);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  outline: none;
  transform: none;
  transition:
    background-color var(--duration-fast),
    border-color var(--duration-fast);
}

.base-button:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-control-hover);
}

.base-button:active {
  background: var(--color-bg-control-active);
}

.base-button:focus-visible {
  border-color: var(--color-border-focus);
  box-shadow: var(--focus-ring);
}

.base-button[aria-pressed='true'] {
  border-color: var(--color-border-selected);
  background: var(--color-bg-selected);
}

.base-button--primary {
  border-color: var(--color-border-selected);
  background: var(--color-accent);
  color: var(--color-text-on-accent);
}

.base-button--primary:hover {
  border-color: var(--color-border-focus);
  background: var(--color-accent-hover);
}

.base-button--primary:active {
  background: var(--color-accent-active);
}

.base-button--danger {
  border-color: var(--color-danger);
  background: var(--color-danger);
  color: var(--color-text-on-accent);
}

.base-button--danger:hover {
  border-color: var(--color-danger-hover);
  background: var(--color-danger-hover);
}

.base-button--ghost {
  border-color: transparent;
  background: transparent;
}

.base-button--ghost:hover {
  border-color: transparent;
  background: var(--color-bg-hover);
}

.base-button--sm {
  height: var(--control-height-sm);
  padding: 0 var(--space-4);
  font-size: var(--font-size-sm);
}

.base-button--block {
  display: flex;
  width: 100%;
}

.base-button:disabled {
  border-color: var(--color-border-subtle);
  background: var(--color-bg-control-active);
  color: var(--color-text-disabled);
  cursor: default;
}

.base-button__label {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
