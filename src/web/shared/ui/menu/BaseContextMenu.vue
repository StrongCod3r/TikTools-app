<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { pointAnchor, type AnchorTarget } from '@/shared/lib/anchored-position.ts';
import BaseMenu from './BaseMenu.vue';
import type { MenuAction, MenuEntry } from './menu-types.ts';

const props = defineProps<{
  items: readonly MenuEntry[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  open: [event: MouseEvent | KeyboardEvent];
  select: [action: MenuAction];
}>();

const open = ref(false);
const anchor = shallowRef<AnchorTarget | null>(null);
const focusFirst = ref(false);
const generation = ref(0);

function show(target: AnchorTarget, event: MouseEvent | KeyboardEvent, keyboard: boolean): void {
  event.preventDefault();
  emit('open', event);
  anchor.value = target;
  focusFirst.value = keyboard;
  generation.value += 1;
  open.value = true;
}

function onContextMenu(event: MouseEvent): void {
  if (props.disabled) return;
  show(pointAnchor(event.clientX, event.clientY), event, false);
}

function onKeydown(event: KeyboardEvent): void {
  if (props.disabled) return;
  if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
  const target = event.target as HTMLElement;
  const rect = target.getBoundingClientRect();
  show(pointAnchor(rect.left + 8, rect.bottom), event, true);
}
</script>

<template>
  <div
    class="base-context-menu"
    @contextmenu="onContextMenu"
    @keydown="onKeydown"
  >
    <slot />
    <BaseMenu
      :key="generation"
      v-model:open="open"
      :items="items"
      :anchor="anchor"
      :focus-first="focusFirst"
      @select="emit('select', $event)"
    />
  </div>
</template>

<style scoped>
.base-context-menu {
  display: contents;
}
</style>
