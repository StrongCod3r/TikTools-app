import type { JsonObject } from '../../../../automation/types.ts';
import { optionFields } from '../../../../automation/plugins/declarative.ts';
import type { ActionOptionItem } from '../../../../shared/messages.ts';
import type { SchemaOption } from '@/shared/ui/schema-form/lib/schema-fields.ts';

export function optionSources(uiHints: JsonObject | undefined): string[] {
  return [...new Set(optionFields(uiHints).map((field) => field.source))];
}

export function fieldOptionsFor(
  uiHints: JsonObject | undefined,
  actionOptions: Readonly<Record<string, readonly ActionOptionItem[]>>,
): Record<string, SchemaOption[]> {
  const merged: Record<string, SchemaOption[]> = {};
  for (const field of optionFields(uiHints)) {
    const options = actionOptions[field.source];
    if (options?.length) merged[field.key] = options.map((option) => ({ ...option }));
  }
  return merged;
}
