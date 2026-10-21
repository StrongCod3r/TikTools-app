import { computed, useAttrs } from 'vue';

export function useSplitAttrs() {
  const attrs = useAttrs();
  const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }));
  const controlAttrs = computed(() =>
    Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'class' && key !== 'style')),
  );
  return { rootAttrs, controlAttrs };
}
