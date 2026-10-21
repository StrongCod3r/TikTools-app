<script setup lang="ts" generic="T, K extends string | number">
import { computed, nextTick, useId, useTemplateRef } from 'vue';

const props = defineProps<{
  items: readonly T[];
  itemKey: (item: T) => K;
}>();

const emit = defineEmits<{ activate: [item: T] }>();
const selected = defineModel<K | null>('selected', { default: null });

const id = useId();
const list = useTemplateRef('list');
const keys = computed(() => props.items.map(props.itemKey));
const selectedIndex = computed(() => (selected.value === null ? -1 : keys.value.indexOf(selected.value)));
const optionId = (index: number): string => `${id}-item-${index}`;

function select(index: number): void {
  const key = keys.value[index];
  if (key === undefined) return;
  selected.value = key;
  void nextTick(() => list.value?.querySelector(`#${CSS.escape(optionId(index))}`)?.scrollIntoView({ block: 'nearest' }));
}

function activate(index: number): void {
  const item = props.items[index];
  if (item !== undefined) emit('activate', item);
}

function onKeydown(event: KeyboardEvent): void {
  const last = props.items.length - 1;
  const from = selectedIndex.value;
  const targets: Record<string, () => number> = {
    ArrowDown: () => Math.min(from + 1, last),
    ArrowUp: () => (from < 0 ? last : Math.max(from - 1, 0)),
    Home: () => 0,
    End: () => last,
  };
  if (event.key === 'Enter' && from >= 0) {
    event.preventDefault();
    activate(from);
    return;
  }
  const target = targets[event.key];
  if (!target || last < 0) return;
  event.preventDefault();
  select(target());
}
</script>

<template>
  <ul
    ref="list"
    class="base-list"
    role="listbox"
    tabindex="0"
    :aria-activedescendant="selectedIndex >= 0 ? optionId(selectedIndex) : undefined"
    @keydown="onKeydown"
  >
    <li
      v-for="(item, index) in items"
      :id="optionId(index)"
      :key="keys[index]"
      class="base-list__item"
      role="option"
      :aria-selected="index === selectedIndex"
      @pointerdown="select(index)"
      @contextmenu="select(index)"
      @dblclick="activate(index)"
    >
      <slot
        :item="item"
        :selected="index === selectedIndex"
      />
    </li>
    <li
      v-if="!items.length && $slots.empty"
      class="base-list__empty"
      role="presentation"
    >
      <slot name="empty" />
    </li>
  </ul>
</template>

<style scoped>
.base-list {
  min-height: 0;
  margin: 0;
  padding: var(--space-1);
  overflow-y: auto;
  background: var(--color-bg-panel);
  color: var(--color-text);
  font-family: var(--font-family);
  font-size: var(--font-size-md);
  list-style: none;
  outline: none;
}

.base-list__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--control-height-md);
  padding: 0 var(--space-3);
  border: var(--border-width) solid transparent;
  border-radius: var(--radius-sm);
  white-space: nowrap;
  cursor: default;
  user-select: none;
}

.base-list__item:hover {
  background: var(--color-bg-hover);
}

.base-list__item[aria-selected='true'] {
  border-color: var(--color-border-selected);
  background: var(--color-bg-selected);
  color: var(--color-text-on-accent);
}

.base-list:focus-visible .base-list__item[aria-selected='true'] {
  border-color: var(--color-border-focus);
}

.base-list__empty {
  padding: var(--space-5);
  color: var(--color-text-subtle);
  text-align: center;
}
</style>
