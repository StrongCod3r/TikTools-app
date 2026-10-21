import { computed, nextTick, ref } from 'vue';
import { firstEnabledIndex, lastEnabledIndex, stepEnabledIndex } from './list-navigation.ts';

interface SelectableItem {
  label?: string;
  disabled?: boolean;
}

export function useRovingSelection(
  items: { readonly value: readonly SelectableItem[] },
  selectedIndex: { readonly value: number },
  onSelect: (index: number) => void,
) {
  const elements = ref<HTMLElement[]>([]);
  const focusIndex = computed(() => (selectedIndex.value >= 0 ? selectedIndex.value : firstEnabledIndex(items.value)));

  function select(index: number): void {
    if (!items.value[index] || items.value[index]?.disabled) return;
    onSelect(index);
    void nextTick(() => elements.value[index]?.focus());
  }

  function onKeydown(event: KeyboardEvent): void {
    const from = focusIndex.value;
    const targets: Record<string, () => number> = {
      ArrowRight: () => stepEnabledIndex(items.value, from, 1),
      ArrowDown: () => stepEnabledIndex(items.value, from, 1),
      ArrowLeft: () => stepEnabledIndex(items.value, from, -1),
      ArrowUp: () => stepEnabledIndex(items.value, from, -1),
      Home: () => firstEnabledIndex(items.value),
      End: () => lastEnabledIndex(items.value),
    };
    const target = targets[event.key];
    if (!target) return;
    event.preventDefault();
    select(target());
  }

  function setElement(index: number, element: unknown): void {
    if (element instanceof HTMLElement) elements.value[index] = element;
  }

  return { focusIndex, select, onKeydown, setElement };
}
