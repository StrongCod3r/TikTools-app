<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue';

const props = withDefaults(
  defineProps<{
    orientation?: 'horizontal' | 'vertical';
    min?: number;
    max?: number;
    step?: number;
  }>(),
  { orientation: 'horizontal', min: 80, max: Infinity, step: 16 },
);

const size = defineModel<number>('size', { default: 240 });
const container = useTemplateRef('container');
const dragging = ref(false);

const horizontal = computed(() => props.orientation === 'horizontal');

function available(): number {
  const rect = container.value?.getBoundingClientRect();
  const extent = rect ? (horizontal.value ? rect.width : rect.height) : 0;
  return extent > 0 ? Math.min(props.max, extent - props.min) : props.max;
}

function clampSize(value: number): number {
  return Math.round(Math.min(Math.max(value, props.min), Math.max(props.min, available())));
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  dragging.value = true;
  const origin = horizontal.value ? event.clientX : event.clientY;
  const initial = size.value;
  const onMove = (move: PointerEvent): void => {
    const position = horizontal.value ? move.clientX : move.clientY;
    size.value = clampSize(initial + position - origin);
  };
  const onUp = (): void => {
    dragging.value = false;
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}

function onKeydown(event: KeyboardEvent): void {
  const [grow, shrink] = horizontal.value ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp'];
  const targets: Record<string, () => number> = {
    [grow]: () => size.value + props.step,
    [shrink]: () => size.value - props.step,
    Home: () => props.min,
    End: () => available(),
  };
  const target = targets[event.key];
  if (!target) return;
  event.preventDefault();
  size.value = clampSize(target());
}
</script>

<template>
  <div
    ref="container"
    class="base-splitter"
    :class="[`base-splitter--${orientation}`, { 'base-splitter--dragging': dragging }]"
  >
    <div
      class="base-splitter__pane"
      :style="{ flexBasis: `${size}px` }"
    >
      <slot name="start" />
    </div>
    <div
      class="base-splitter__handle"
      role="separator"
      tabindex="0"
      :aria-orientation="horizontal ? 'vertical' : 'horizontal'"
      :aria-valuenow="size"
      :aria-valuemin="min"
      :aria-valuemax="Number.isFinite(max) ? max : undefined"
      @pointerdown="onPointerDown"
      @keydown="onKeydown"
    />
    <div class="base-splitter__pane base-splitter__pane--fill">
      <slot name="end" />
    </div>
  </div>
</template>

<style scoped>
.base-splitter {
  display: flex;
  min-width: 0;
  min-height: 0;
}

.base-splitter--vertical {
  flex-direction: column;
}

.base-splitter__pane {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.base-splitter__pane--fill {
  flex: 1 1 0;
}

.base-splitter__handle {
  flex: none;
  background: transparent;
  outline: none;
  touch-action: none;
  transition: background-color var(--duration-fast);
}

.base-splitter--horizontal > .base-splitter__handle {
  width: 4px;
  cursor: col-resize;
}

.base-splitter--vertical > .base-splitter__handle {
  height: 4px;
  cursor: row-resize;
}

.base-splitter__handle:hover,
.base-splitter__handle:focus-visible,
.base-splitter--dragging > .base-splitter__handle {
  background: var(--color-accent);
}

.base-splitter--dragging {
  user-select: none;
}
</style>
