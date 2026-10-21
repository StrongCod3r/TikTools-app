<script setup lang="ts">
import { onMounted, onUpdated, useTemplateRef } from 'vue';

const props = withDefaults(
  defineProps<{
    orientation?: 'horizontal' | 'vertical';
  }>(),
  { orientation: 'horizontal' },
);

const toolbar = useTemplateRef('toolbar');
let current: HTMLElement | null = null;

function items(): HTMLElement[] {
  return Array.from(
    toolbar.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [role="button"]:not([aria-disabled="true"])') ?? [],
  );
}

function syncTabStops(): void {
  const all = items();
  if (!current || !all.includes(current)) current = all[0] ?? null;
  for (const item of all) item.tabIndex = item === current ? 0 : -1;
}

function focusItem(item: HTMLElement | undefined): void {
  if (!item) return;
  current = item;
  syncTabStops();
  item.focus();
}

function onFocusin(event: FocusEvent): void {
  const target = event.target as HTMLElement;
  if (!items().includes(target)) return;
  current = target;
  syncTabStops();
}

function onKeydown(event: KeyboardEvent): void {
  const all = items();
  const index = current ? all.indexOf(current) : -1;
  const [next, previous] = props.orientation === 'horizontal' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp'];
  const targets: Record<string, () => HTMLElement | undefined> = {
    [next]: () => all[(index + 1) % all.length],
    [previous]: () => all[(index - 1 + all.length) % all.length],
    Home: () => all[0],
    End: () => all.at(-1),
  };
  const target = targets[event.key];
  if (!target || !all.length) return;
  event.preventDefault();
  focusItem(target());
}

onMounted(syncTabStops);
onUpdated(syncTabStops);
</script>

<template>
  <div
    ref="toolbar"
    class="base-toolbar"
    :class="`base-toolbar--${orientation}`"
    role="toolbar"
    :aria-orientation="orientation"
    @focusin="onFocusin"
    @keydown="onKeydown"
  >
    <slot />
  </div>
</template>

<style scoped>
.base-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.base-toolbar--vertical {
  flex-direction: column;
}
</style>
