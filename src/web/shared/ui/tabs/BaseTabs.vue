<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, ref, useId } from 'vue';
import { firstEnabledIndex, lastEnabledIndex, stepEnabledIndex } from '@/shared/lib/list-navigation.ts';
import type { SelectOption } from '../types.ts';

const props = defineProps<{
  tabs: readonly SelectOption<T>[];
}>();

const model = defineModel<T>({ required: true });
const id = useId();
const tabElements = ref<HTMLElement[]>([]);

const selectedIndex = computed(() => props.tabs.findIndex((tab) => tab.value === model.value));
const tabId = (index: number): string => `${id}-tab-${index}`;
const panelId = `${id}-panel`;

function select(index: number): void {
  const tab = props.tabs[index];
  if (!tab || tab.disabled) return;
  model.value = tab.value;
  void nextTick(() => tabElements.value[index]?.focus());
}

function onKeydown(event: KeyboardEvent): void {
  const from = selectedIndex.value;
  const targets: Record<string, () => number> = {
    ArrowRight: () => stepEnabledIndex(props.tabs, from, 1),
    ArrowLeft: () => stepEnabledIndex(props.tabs, from, -1),
    Home: () => firstEnabledIndex(props.tabs),
    End: () => lastEnabledIndex(props.tabs),
  };
  const target = targets[event.key];
  if (!target) return;
  event.preventDefault();
  select(target());
}
</script>

<template>
  <div class="base-tabs">
    <div
      class="base-tabs__list"
      role="tablist"
      @keydown="onKeydown"
    >
      <button
        v-for="(tab, index) in tabs"
        :id="tabId(index)"
        :key="String(tab.value)"
        :ref="(element) => (tabElements[index] = element as HTMLElement)"
        class="base-tabs__tab"
        type="button"
        role="tab"
        :aria-selected="index === selectedIndex"
        :aria-controls="panelId"
        :tabindex="index === selectedIndex ? 0 : -1"
        :disabled="tab.disabled"
        @click="select(index)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div
      :id="panelId"
      class="base-tabs__panel"
      role="tabpanel"
      tabindex="0"
      :aria-labelledby="selectedIndex >= 0 ? tabId(selectedIndex) : undefined"
    >
      <slot :value="model" />
    </div>
  </div>
</template>

<style scoped>
.base-tabs {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.base-tabs__list {
  display: flex;
  flex: none;
  gap: var(--space-1);
  border-bottom: var(--border-width) solid var(--color-border);
}

.base-tabs__tab {
  position: relative;
  height: var(--control-height-md);
  padding: 0 var(--space-5);
  border: var(--border-width) solid transparent;
  border-bottom: 0;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-family);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-regular);
  cursor: pointer;
  outline: none;
  transform: none;
}

.base-tabs__tab:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.base-tabs__tab[aria-selected='true'] {
  border-color: var(--color-border);
  background: var(--color-bg-panel-header);
  color: var(--color-text);
}

.base-tabs__tab[aria-selected='true']::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: var(--color-accent);
  content: '';
}

.base-tabs__tab:focus-visible {
  box-shadow: var(--focus-ring);
}

.base-tabs__tab:disabled {
  background: transparent;
  color: var(--color-text-disabled);
  cursor: default;
}

.base-tabs__panel {
  flex: 1;
  min-height: 0;
  outline: none;
}
</style>
