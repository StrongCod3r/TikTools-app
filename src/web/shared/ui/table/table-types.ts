export interface TableColumn {
  key: string;
  label: string;
  width?: string;
  align?: 'start' | 'center' | 'end';
  sortable?: boolean;
}

export type SortDirection = 'asc' | 'desc';

export interface TableSort {
  key: string;
  direction: SortDirection;
}

export function nextSort(current: TableSort | null, key: string): TableSort {
  if (current?.key !== key) return { key, direction: 'asc' };
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}
