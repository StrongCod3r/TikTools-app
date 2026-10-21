import type { WidgetStyle } from '../../../../widgets/sdk/template.ts';

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneDesign(design: WidgetStyle): WidgetStyle {
  return jsonClone(design);
}

export class EditorHistory<T = WidgetStyle> {
  private readonly past: T[] = [];
  private readonly future: T[] = [];

  constructor(
    private readonly capacity = 50,
    private readonly clone: (value: T) => T = jsonClone,
  ) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get depth(): number {
    return this.past.length;
  }

  commit(before: T): void {
    this.past.push(this.clone(before));
    if (this.past.length > this.capacity) this.past.splice(0, this.past.length - this.capacity);
    this.future.length = 0;
  }

  undo(current: T): T | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(this.clone(current));
    return previous;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.clone(current));
    return next;
  }
}
