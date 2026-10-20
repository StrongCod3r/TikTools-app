import type { JsonObject, JsonValue } from '../../../../../automation/types.ts';

export type SchemaControlKind =
  | 'gift'
  | 'media'
  | 'boolean'
  | 'keyvalue'
  | 'date'
  | 'time'
  | 'color'
  | 'secret'
  | 'range'
  | 'rating'
  | 'multiselect'
  | 'tags'
  | 'textarea'
  | 'select'
  | 'search'
  | 'json'
  | 'number'
  | 'text';

export interface SchemaOption {
  value: string;
  label: string;
  disabled?: boolean;
  meta?: { giftId?: string; diamondCount?: number; iconUrl?: string };
}

export interface SchemaFieldDescriptor {
  key: string;
  kind: SchemaControlKind;
  label: string;
  hint: string;
  placeholder?: string;
  options: SchemaOption[];
  defaultValue?: JsonValue;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  arrayJson: boolean;
  monospace: boolean;
  template: boolean;
  advanced: boolean;
  media?: { mode: 'file' | 'directory'; kind: 'audio' | 'video' | 'image' | 'other'; extensions?: string[] };
}

type Localize = (value: unknown) => string;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function objectProperties(value: JsonValue | undefined): Record<string, JsonObject> {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, JsonObject] => isObject(entry[1])));
}

export function fieldHints(uiHints: JsonObject | undefined): Record<string, JsonObject> {
  return objectProperties(uiHints?.fields);
}

export function applies(condition: JsonValue | undefined, values: JsonObject): boolean {
  if (!isObject(condition)) return true;
  const key = typeof condition.key === 'string' ? condition.key : '';
  if (!key) return true;
  const current = String(values[key] ?? '');
  const equals = Array.isArray(condition.equals) ? condition.equals : [];
  const notEquals = Array.isArray(condition.notEquals) ? condition.notEquals : [];
  if (equals.length > 0 && !equals.some((entry) => String(entry) === current)) return false;
  return !notEquals.some((entry) => String(entry) === current);
}

function numberOf(...candidates: JsonValue[]): number | undefined {
  return candidates.find((candidate): candidate is number => typeof candidate === 'number');
}

function staticOptions(schema: JsonObject, hint: JsonObject | undefined, localize: Localize): SchemaOption[] {
  if (Array.isArray(schema.enum)) {
    return schema.enum.filter((entry): entry is string => typeof entry === 'string').map((value) => ({ value, label: value }));
  }
  if (!Array.isArray(hint?.options)) return [];
  return hint.options.filter(isObject).map((entry) => {
    const value = typeof entry.value === 'string' ? entry.value : '';
    return { value, label: localize(entry.label) || value };
  });
}

function controlKind(
  schema: JsonObject,
  hint: JsonObject | undefined,
  options: SchemaOption[],
  dynamic: boolean,
  template: boolean,
): SchemaControlKind {
  const kind = typeof hint?.kind === 'string' ? hint.kind : undefined;
  const items = isObject(schema.items) ? schema.items : undefined;
  if (hint?.picker === 'gift' || kind === 'gift') return 'gift';
  if (kind === 'media') return 'media';
  if (kind === 'boolean' || schema.type === 'boolean') return 'boolean';
  if (kind === 'keyvalue' || (schema.type === 'object' && schema.additionalProperties !== undefined)) return 'keyvalue';
  if (schema.format === 'date' || kind === 'date') return 'date';
  if (schema.format === 'time' || kind === 'time') return 'time';
  if (schema.format === 'color' || kind === 'color') return 'color';
  if (schema.format === 'password' || kind === 'password' || schema.secret === true || hint?.secret === true) return 'secret';
  if (kind === 'range' && (schema.type === 'number' || schema.type === 'integer')) return 'range';
  if (kind === 'rating') return 'rating';
  if (schema.type === 'array' && Array.isArray(items?.enum)) return 'multiselect';
  if (schema.type === 'array' && (kind === 'tags' || items?.type === 'string')) return 'tags';
  if (options.length > 0) return dynamic ? 'search' : 'select';
  if (schema.type === 'array' || schema.format === 'json' || kind === 'code') return 'json';
  if ((kind === 'textarea' || schema.format === 'multiline') && schema.type === 'string') return 'textarea';
  if (kind === 'textarea' && !template) return 'textarea';
  if (kind === 'number' || schema.type === 'number' || schema.type === 'integer') return 'number';
  return 'text';
}

export function describeField(
  key: string,
  schema: JsonObject,
  hint: JsonObject | undefined,
  dynamicOptions: readonly SchemaOption[] | undefined,
  localize: Localize,
): SchemaFieldDescriptor {
  const fixed = staticOptions(schema, hint, localize);
  const dynamic = fixed.length === 0 && Boolean(dynamicOptions?.length);
  const options = fixed.length > 0 ? fixed : [...(dynamicOptions ?? [])];
  const template = hint?.template === true;
  const kind = controlKind(schema, hint, options, dynamic, template);
  const items = isObject(schema.items) ? schema.items : undefined;
  const descriptor: SchemaFieldDescriptor = {
    key,
    kind,
    label: localize(schema.title) || key,
    hint: localize(hint?.hint) || localize(schema.description),
    placeholder: typeof hint?.placeholder === 'string' ? hint.placeholder : undefined,
    options:
      kind === 'multiselect' && Array.isArray(items?.enum)
        ? items.enum.filter((entry): entry is string => typeof entry === 'string').map((value) => ({ value, label: value }))
        : options,
    defaultValue: schema.default,
    min: numberOf(schema.minimum ?? null, schema.min ?? null),
    max: numberOf(schema.maximum ?? null, schema.max ?? null),
    step: numberOf(schema.multipleOf ?? null),
    maxLength: numberOf(schema.maxLength ?? null),
    arrayJson: schema.type === 'array',
    monospace: kind === 'json' || hint?.kind === 'code',
    template,
    advanced: hint?.advanced === true,
  };
  if (kind === 'media') {
    const mediaKind = hint?.mediaKind;
    descriptor.media = {
      mode: hint?.mode === 'directory' ? 'directory' : 'file',
      kind: mediaKind === 'video' || mediaKind === 'image' || mediaKind === 'other' ? mediaKind : 'audio',
      extensions: Array.isArray(hint?.extensions)
        ? hint.extensions.filter((entry): entry is string => typeof entry === 'string')
        : undefined,
    };
  }
  return descriptor;
}

export function describeForm(
  schema: JsonObject,
  uiHints: JsonObject | undefined,
  values: JsonObject,
  fieldOptions: Readonly<Record<string, readonly SchemaOption[]>>,
  localize: Localize,
): { basic: SchemaFieldDescriptor[]; advanced: SchemaFieldDescriptor[] } {
  const hints = fieldHints(uiHints);
  const fields = Object.entries(objectProperties(schema.properties))
    .filter(([key]) => applies(hints[key]?.showIf, values))
    .map(([key, field]) => describeField(key, field, hints[key], fieldOptions[key], localize));
  return { basic: fields.filter((field) => !field.advanced), advanced: fields.filter((field) => field.advanced) };
}

export function acceptsValue(field: SchemaFieldDescriptor, value: unknown): value is JsonValue {
  if (field.kind === 'boolean') return typeof value === 'boolean';
  if (field.kind === 'number' || field.kind === 'range' || field.kind === 'rating') return typeof value === 'number';
  return value !== undefined && !(typeof Event !== 'undefined' && value instanceof Event);
}

export function textValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2) ?? '';
}

export function numericValue(value: JsonValue | undefined, field: SchemaFieldDescriptor): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(parsed) && value !== '' && value !== null && value !== undefined) return parsed;
  if (typeof field.defaultValue === 'number') return field.defaultValue;
  return field.min ?? 0;
}

export function stringList(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function stringRecord(value: JsonValue | undefined): Record<string, string> {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === 'string' ? entry : textValue(entry)]));
}

export function mediaPath(value: JsonValue | undefined): string {
  if (isObject(value) && typeof value.path === 'string') return value.path;
  return textValue(value);
}

export function parseJsonField(text: string, field: SchemaFieldDescriptor): JsonValue {
  if (!field.arrayJson) return text;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

export function withSchemaDefaults(values: JsonObject, schema: JsonObject | undefined): JsonObject {
  let filled: JsonObject | undefined;
  for (const [key, field] of Object.entries(objectProperties(schema?.properties))) {
    if (values[key] !== undefined || field.secret === true) continue;
    const fallback = field.default;
    if (typeof fallback !== 'string' && typeof fallback !== 'number' && typeof fallback !== 'boolean') continue;
    filled ??= { ...values };
    filled[key] = fallback;
  }
  return filled ?? values;
}
