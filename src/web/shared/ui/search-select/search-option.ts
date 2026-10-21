export interface SearchOption {
  value: string;
  label: string;
  detail?: string;
  iconUrl?: string;
  disabled?: boolean;
}

export function filterSearchOptions(options: readonly SearchOption[], query: string): SearchOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...options];
  return options.filter(
    (option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
  );
}
