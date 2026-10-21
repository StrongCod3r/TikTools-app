const avatarColors = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
] as const;

export function avatarColor(handle: string): string {
  let hash = 0;
  for (let index = 0; index < handle.length; index += 1) {
    hash = handle.charCodeAt(index) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length]!;
}

export function avatarInitials(handle: string): string {
  return handle.replace(/^@+/, '').slice(0, 2).toUpperCase() || '•';
}
