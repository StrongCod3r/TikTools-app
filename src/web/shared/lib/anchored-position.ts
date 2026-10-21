export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start' | 'left-start';

export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface AnchorTarget {
  getBoundingClientRect(): Rect;
}

export function pointAnchor(x: number, y: number): AnchorTarget {
  return { getBoundingClientRect: () => ({ top: y, left: x, right: x, bottom: y, width: 0, height: 0 }) };
}

export interface Size {
  width: number;
  height: number;
}

export interface Position {
  top: number;
  left: number;
  placement: Placement;
}

const flipped: Record<Placement, Placement> = {
  'bottom-start': 'top-start',
  'bottom-end': 'top-start',
  'top-start': 'bottom-start',
  'right-start': 'left-start',
  'left-start': 'right-start',
};

function place(anchor: Rect, floating: Size, placement: Placement, offset: number): { top: number; left: number } {
  switch (placement) {
    case 'bottom-start':
      return { top: anchor.bottom + offset, left: anchor.left };
    case 'bottom-end':
      return { top: anchor.bottom + offset, left: anchor.right - floating.width };
    case 'top-start':
      return { top: anchor.top - offset - floating.height, left: anchor.left };
    case 'right-start':
      return { top: anchor.top, left: anchor.right + offset };
    case 'left-start':
      return { top: anchor.top, left: anchor.left - offset - floating.width };
  }
}

function fits(position: { top: number; left: number }, floating: Size, viewport: Size): boolean {
  return (
    position.top >= 0 &&
    position.left >= 0 &&
    position.top + floating.height <= viewport.height &&
    position.left + floating.width <= viewport.width
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function computeAnchoredPosition(
  anchor: Rect,
  floating: Size,
  viewport: Size,
  placement: Placement,
  offset = 0,
): Position {
  let resolved = placement;
  let position = place(anchor, floating, placement, offset);
  if (!fits(position, floating, viewport)) {
    const alternative = place(anchor, floating, flipped[placement], offset);
    if (fits(alternative, floating, viewport)) {
      resolved = flipped[placement];
      position = alternative;
    }
  }
  return {
    top: clamp(position.top, 0, viewport.height - floating.height),
    left: clamp(position.left, 0, viewport.width - floating.width),
    placement: resolved,
  };
}
