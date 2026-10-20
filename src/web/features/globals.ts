import type { AutocompleteItem } from '../components/autocomplete/index.ts';
import { sortedGlobalEntries } from '@/entities/runtime-global/lib/global-key.ts';
import type { Locale } from '../i18n.ts';

function inferKind(value: string): AutocompleteItem['kind'] {
  const trimmed = value.trim();
  if (trimmed === 'true' || trimmed === 'false') return 'boolean';
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return 'number';
  return 'string';
}

function previewValue(value: string): string {
  return value.length > 64 ? `${value.slice(0, 61)}...` : value;
}

export function globalSuggestionItems(
  globals: Record<string, string>,
  locale: Locale,
): AutocompleteItem[] {
  return sortedGlobalEntries(globals).map(([key, value]) => ({
    value: `globals.${key}`,
    label: key,
    kind: inferKind(value),
    detail: 'Global',
    documentation: locale === 'es'
      ? `Global en tiempo de ejecución · ${key} = ${previewValue(value)}`
      : `Runtime global · ${key} = ${previewValue(value)}`,
    preview: previewValue(value),
  }));
}
