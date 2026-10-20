<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import BaseMenu from './BaseMenu.vue';
import type { MenuAction, MenuBarMenu } from './menu-types.ts';

const props = defineProps<{
  menus: readonly MenuBarMenu[];
}>();

const emit = defineEmits<{ select: [action: MenuAction] }>();

const buttons = ref<HTMLElement[]>([]);
const openIndex = ref<number | null>(null);
const focusFirst = ref(false);

const openMenu = computed(() => (openIndex.value === null ? null : (props.menus[openIndex.value] ?? null)));

function show(index: number, keyboard: boolean): void {
  focusFirst.value = keyboard;
  openIndex.value = index;
}

function close(): void {
  const index = openIndex.value;
  openIndex.value = null;
  void nextTick(() => {
    const active = document.activeElement;
    if (index !== null && (!active || active === document.body)) buttons.value[index]?.focus();
  });
}

function wrap(index: number): number {
  return (index + props.menus.length) % props.menus.length;
}

function onClick(index: number): void {
  if (openIndex.value === index) close();
  else show(index, false);
}

function onPointerEnter(index: number): void {
  if (openIndex.value !== null && openIndex.value !== index) show(index, false);
}

function onNavigate(direction: 1 | -1): void {
  if (openIndex.value === null) return;
  const index = wrap(openIndex.value + direction);
  buttons.value[index]?.focus();
  show(index, true);
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
  const move = moves[event.key];
  if (move !== undefined) {
    event.preventDefault();
    const target = wrap(index + move);
    buttons.value[target]?.focus();
    return;
  }
  if (['ArrowDown', 'Enter', ' '].includes(event.key)) {
    event.preventDefault();
    show(index, true);
  }
}

function onSelect(action: MenuAction): void {
  close();
  void nextTick(() => emit('select', action));
}
</script>

<template>
  <div
    class="base-menu-bar"
    role="menubar"
  >
    <button
      v-for="(menu, index) in menus"
      :key="menu.id"
      :ref="(element) => (buttons[index] = element as HTMLElement)"
      class="base-menu-bar__item"
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      :aria-expanded="openIndex === index"
      :tabindex="index === (openIndex ?? 0) ? 0 : -1"
      @click="onClick(index)"
      @pointerenter="onPointerEnter(index)"
      @keydown="onKeydown($event, index)"
    >
      {{ menu.label }}
    </button>
    <BaseMenu
      v-if="openMenu && openIndex !== null"
      :key="openMenu.id"
      :open="true"
      :items="openMenu.items"
      :anchor="buttons[openIndex] ?? null"
      :focus-first="focusFirst"
      @update:open="(value) => !value && close()"
      @navigate="onNavigate"
      @select="onSelect"
    />
  </div>
</template>

<style scoped>
.base-menu-bar {
  display: flex;
  align-items: stretch;
  height: var(--control-height-md);
}

.base-menu-bar__item {
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-family: var(--font-family);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-regular);
  cursor: default;
  outline: none;
  transform: none;
}

.base-menu-bar__item:hover,
.base-menu-bar__item:focus-visible {
  background: var(--color-bg-hover);
}

.base-menu-bar__item[aria-expanded='true'] {
  background: var(--color-bg-selected);
  color: var(--color-text-on-accent);
}
</style>
