
export interface KeyCaptureSource {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface CapturedShortcut {
  key: string;
  modifiers: string;
}

const MODIFIER_NAMES = new Set(['ctrl', 'shift', 'alt', 'meta']);

export function normalizeKeyName(key: string): string {
  if (!key) return '';
  if (key === ' ') return 'space';
  if (key.length === 1) return key.toLowerCase();
  switch (key) {
    case 'Enter': return 'enter';
    case 'Tab': return 'tab';
    case 'Escape': return 'esc';
    case 'Backspace': return 'backspace';
    case 'Delete': return 'delete';
    case 'Insert': return 'insert';
    case 'Home': return 'home';
    case 'End': return 'end';
    case 'PageUp': return 'pageup';
    case 'PageDown': return 'pagedown';
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'CapsLock': return 'capslock';
    case 'Control': return 'ctrl';
    case 'Shift': return 'shift';
    case 'Alt': return 'alt';
    case 'Meta': return 'meta';
    case 'Dead': return '';
    default: return key.toLowerCase();
  }
}

export function isModifierName(name: string): boolean {
  return MODIFIER_NAMES.has(name);
}

export function normalizeCapturedKey(event: KeyCaptureSource): CapturedShortcut | null {
  const key = normalizeKeyName(event.key);
  if (!key || isModifierName(key)) return null;
  const modifiers = [
    event.ctrlKey && 'ctrl',
    event.shiftKey && 'shift',
    event.altKey && 'alt',
    event.metaKey && 'meta',
  ].filter((entry): entry is string => Boolean(entry));
  return { key, modifiers: modifiers.join('+') };
}
