import { nextTick, onScopeDispose, ref, watch, type CSSProperties, type Ref } from 'vue';
import { computeAnchoredPosition, type AnchorTarget, type Placement } from './anchored-position.ts';

export interface AnchoredPositionOptions {
  placement?: Placement;
  offset?: number;
  matchAnchorWidth?: boolean;
}

export function useAnchoredPosition(
  anchor: Readonly<Ref<AnchorTarget | null>>,
  floating: Readonly<Ref<HTMLElement | null>>,
  open: Readonly<Ref<boolean>>,
  options: AnchoredPositionOptions = {},
) {
  const style = ref<CSSProperties>({ position: 'fixed', top: '0px', left: '0px', opacity: 0 });
  const placement = ref<Placement>(options.placement ?? 'bottom-start');

  const update = (): void => {
    const anchorElement = anchor.value;
    const floatingElement = floating.value;
    if (!anchorElement || !floatingElement) return;
    const anchorRect = anchorElement.getBoundingClientRect();
    const minWidth = options.matchAnchorWidth ? anchorRect.width : 0;
    const width = Math.max(floatingElement.offsetWidth, minWidth);
    const position = computeAnchoredPosition(
      anchorRect,
      { width, height: floatingElement.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      options.placement ?? 'bottom-start',
      options.offset ?? 0,
    );
    placement.value = position.placement;
    style.value = {
      position: 'fixed',
      top: `${position.top}px`,
      left: `${position.left}px`,
      ...(options.matchAnchorWidth ? { minWidth: `${minWidth}px` } : {}),
    };
  };

  const listen = (active: boolean): void => {
    const method = active ? 'addEventListener' : 'removeEventListener';
    window[method]('resize', update);
    window[method]('scroll', update, true);
  };

  watch(
    open,
    async (isOpen) => {
      listen(false);
      if (!isOpen) {
        style.value = { ...style.value, opacity: 0 };
        return;
      }
      await nextTick();
      update();
      listen(true);
    },
    { immediate: true },
  );

  onScopeDispose(() => listen(false));

  return { style, placement, update };
}
