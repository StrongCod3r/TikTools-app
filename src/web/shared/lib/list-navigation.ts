interface NavigableOption {
  label?: string;
  disabled?: boolean;
}

export function stepEnabledIndex(options: readonly NavigableOption[], from: number, direction: 1 | -1): number {
  for (let index = from + direction; index >= 0 && index < options.length; index += direction) {
    if (!options[index]?.disabled) return index;
  }
  return from;
}

export function firstEnabledIndex(options: readonly NavigableOption[]): number {
  return stepEnabledIndex(options, -1, 1);
}

export function lastEnabledIndex(options: readonly NavigableOption[]): number {
  return stepEnabledIndex(options, options.length, -1);
}

export function typeaheadIndex(options: readonly NavigableOption[], query: string, from: number): number {
  const needle = query.toLocaleLowerCase();
  const count = options.length;
  const start = query.length > 1 ? from : from + 1;
  for (let offset = 0; offset < count; offset += 1) {
    const index = (start + offset + count) % count;
    const option = options[index];
    if (option?.label && !option.disabled && option.label.toLocaleLowerCase().startsWith(needle)) return index;
  }
  return -1;
}
