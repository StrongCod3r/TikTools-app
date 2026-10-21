export type LibraryTab = 'events' | 'actions';

export function isLibraryTab(value: unknown): value is LibraryTab {
  return value === 'events' || value === 'actions';
}
