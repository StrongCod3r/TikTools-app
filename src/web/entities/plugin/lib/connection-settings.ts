import type { JsonObject, JsonValue } from '../../../../automation/types.ts';
import { isSecretField, SECRET_PLACEHOLDER } from '../../../../automation/plugins/declarative.ts';
import { withSchemaDefaults } from '@/shared/ui/schema-form/lib/schema-fields.ts';

export const AUTOSAVE_DEBOUNCE_MS = 800;
export const AUTOSAVE_CONFIRM_TIMEOUT_MS = 5000;
export const SUMMARY_ROW_LIMIT = 4;
const MAX_URL_LEN = 2048;

export function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LEN) return false;
  try {
    const url = new URL(trimmed);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function isLoopbackUrl(value: string): boolean {
  let host: string;
  try {
    host = new URL(value.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function schemaProperties(schema: JsonObject | undefined): Array<[string, JsonObject]> {
  const properties = schema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  const entries: Array<[string, JsonObject]> = [];
  for (const [key, field] of Object.entries(properties as JsonObject)) {
    if (field && typeof field === 'object' && !Array.isArray(field)) {
      entries.push([key, field as JsonObject]);
    }
  }
  return entries;
}

function fieldHint(uiHints: JsonObject | undefined, key: string): JsonObject | undefined {
  const fields = uiHints?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  const hint = (fields as JsonObject)[key];
  return hint && typeof hint === 'object' && !Array.isArray(hint) ? (hint as JsonObject) : undefined;
}

export function findServerUrlKey(schema: JsonObject | undefined): string | undefined {
  for (const [key, field] of schemaProperties(schema)) {
    if (field.type === 'string' && field.format === 'uri') return key;
  }
  return undefined;
}

export function settingDisplayText(value: JsonValue | undefined): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

export type ConnectionSummaryRow = {
  key: string;
  label: string;
  value: string;
};

export function shouldShowSummary(args: {
  editing: boolean;
  dirty: boolean;
  connectionOk: boolean;
  hasSettings: boolean;
}): boolean {
  return !args.editing && !args.dirty && args.connectionOk && args.hasSettings;
}

export function connectionSummaryRows(
  values: JsonObject,
  schema: JsonObject | undefined,
  uiHints: JsonObject | undefined,
  urlKey: string | undefined,
  localize: (value: unknown) => string,
): ConnectionSummaryRow[] {
  const rows: ConnectionSummaryRow[] = [];
  for (const [key, field] of schemaProperties(schema)) {
    if (key === urlKey) continue;
    if (isSecretField(field, fieldHint(uiHints, key))) continue;
    const text = settingDisplayText(values[key]);
    if (!text) continue;
    rows.push({ key, label: localize(field.title) || key, value: text });
    if (rows.length >= SUMMARY_ROW_LIMIT) break;
  }
  return rows;
}

export function settingsEqual(a: JsonObject, b: JsonObject): boolean {
  return stableSettingsJson(a) === stableSettingsJson(b);
}

export function settingsMatch(
  a: JsonObject,
  b: JsonObject,
  secretKeys: readonly string[] = [],
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (left === right) continue;
    if (
      secretKeys.includes(key)
      && (left === SECRET_PLACEHOLDER || right === SECRET_PLACEHOLDER)
      && left !== ''
      && right !== ''
    ) {
      continue;
    }
    return false;
  }
  return true;
}

export function secretSettingKeys(
  schema: JsonObject | undefined,
  uiHints: JsonObject | undefined,
): string[] {
  const keys: string[] = [];
  for (const [key, field] of schemaProperties(schema)) {
    if (isSecretField(field, fieldHint(uiHints, key))) keys.push(key);
  }
  return keys;
}

export function echoConfirmsSave(
  echo: JsonObject,
  sent: JsonObject,
  secretKeys: readonly string[] = [],
): boolean {
  return Object.entries(sent).every(([key, value]) => {
    if (echo[key] === value) return true;
    return secretKeys.includes(key) && echo[key] === SECRET_PLACEHOLDER;
  });
}

export function stableSettingsJson(values: JsonObject): string {
  const keys = Object.keys(values).sort();
  return JSON.stringify(keys.map((key) => [key, values[key]]));
}

export function echoNeedsResave(
  draft: JsonObject,
  echoValues: JsonObject,
  schema: JsonObject | undefined,
  secretKeys: readonly string[] = [],
): boolean {
  return !settingsMatch(
    withSchemaDefaults(draft, schema),
    withSchemaDefaults(echoValues, schema),
    secretKeys,
  );
}
