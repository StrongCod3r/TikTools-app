import { onScopeDispose, watch, type Ref } from 'vue';

export function useOutsidePointer(
  elements: ReadonlyArray<Readonly<Ref<HTMLElement | null>>>,
  active: Readonly<Ref<boolean>>,
  handler: (event: PointerEvent) => void,
): void {
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (target && elements.some((element) => element.value?.contains(target))) return;
    handler(event);
  };

  const stop = watch(
    active,
    (isActive) => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      if (isActive) document.addEventListener('pointerdown', onPointerDown, true);
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    stop();
    document.removeEventListener('pointerdown', onPointerDown, true);
  });
}
