<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
  }>(),
  { min: 0, max: 100, step: 1 },
);

const model = defineModel<number>({ default: 0 });

const fill = computed(() => {
  const span = props.max - props.min;
  if (span <= 0) return '0%';
  const ratio = (Math.min(Math.max(model.value, props.min), props.max) - props.min) / span;
  return `${ratio * 100}%`;
});
</script>

<template>
  <input
    v-model.number="model"
    class="base-slider"
    type="range"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    :style="{ '--slider-fill': fill }"
  >
</template>

<style scoped>
.base-slider {
  --slider-track: var(--color-bg-field);
  --slider-progress: var(--color-accent);
  --slider-thumb: var(--color-handle);

  appearance: none;
  width: 100%;
  min-width: 60px;
  height: var(--control-height-sm);
  margin: 0;
  background: transparent;
  cursor: pointer;
  outline: none;
}

.base-slider::-webkit-slider-runnable-track {
  height: 4px;
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: linear-gradient(
    to right,
    var(--slider-progress) 0 var(--slider-fill),
    var(--slider-track) var(--slider-fill) 100%
  );
}

.base-slider::-webkit-slider-thumb {
  appearance: none;
  width: 10px;
  height: 16px;
  margin-top: -7px;
  border: var(--border-width) solid var(--color-bg-app);
  border-radius: var(--radius-sm);
  background: var(--slider-thumb);
}

.base-slider:hover::-webkit-slider-thumb {
  background: var(--color-handle-hover);
}

.base-slider:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}

.base-slider:disabled {
  --slider-progress: var(--color-text-disabled);
  --slider-thumb: var(--color-text-disabled);

  cursor: default;
}
</style>
