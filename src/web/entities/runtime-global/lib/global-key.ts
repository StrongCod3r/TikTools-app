// Mirrors the host key rule in the control API.
const GLOBAL_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

export function isGlobalKey(key: string): boolean {
  return GLOBAL_KEY_PATTERN.test(key);
}

export function sortedGlobalEntries(globals: Record<string, string>): [string, string][] {
  return Object.entries(globals).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}
