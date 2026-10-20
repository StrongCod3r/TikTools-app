import { defaultActionConfig } from '../../../../automation/behavior/action-config.ts';
import { BEHAVIOR_TRIGGERS, createActionId, createEventId, readString } from '../../../../automation/behavior/schema.ts';
import type {
  ActionTypeDefinition,
  BehaviorRun,
  LiveAction,
  LiveEvent,
  PluginEventType,
  PluginStatus,
} from '../../../../automation/behavior/types.ts';

export type Localize = (value: unknown) => string;
export type RecordSort = 'name' | 'name-desc' | 'enabled' | 'disabled';

export const recordSorts: readonly RecordSort[] = ['name', 'name-desc', 'enabled', 'disabled'];
export const COOLDOWN_CHOICES: readonly number[] = [0, 3_000, 5_000, 10_000, 30_000, 60_000];

export function isRecordSort(value: unknown): value is RecordSort {
  return typeof value === 'string' && (recordSorts as readonly string[]).includes(value);
}

export function sortRecords<T extends { name: string; enabled: boolean }>(rows: readonly T[], sort: RecordSort): T[] {
  return [...rows].sort((left, right) => {
    if (sort === 'enabled' || sort === 'disabled') {
      const delta = Number(right.enabled) - Number(left.enabled);
      if (delta !== 0) return sort === 'enabled' ? delta : -delta;
      return left.name.localeCompare(right.name);
    }
    const byName = left.name.localeCompare(right.name);
    return sort === 'name-desc' ? -byName : byName;
  });
}

export function matchesQuery(query: string, ...haystack: readonly string[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = haystack.join(' ').toLowerCase();
  return words.every((word) => text.includes(word));
}

export function availableActionTypeIds(plugins: readonly PluginStatus[], actionTypes: readonly ActionTypeDefinition[]): Set<string> {
  const active = new Set(plugins.filter((plugin) => plugin.installed && plugin.enabled).map((plugin) => plugin.descriptor.id));
  const ids = new Set<string>();
  for (const type of actionTypes) {
    if (type.source.kind === 'builtin' || active.has(type.source.pluginId)) ids.add(type.id);
  }
  return ids;
}

export function actionTypeOf(action: LiveAction, actionTypes: readonly ActionTypeDefinition[]): ActionTypeDefinition | undefined {
  return actionTypes.find((type) => type.id === action.typeId);
}

export function createActionFromType(type: ActionTypeDefinition, localize: Localize): LiveAction {
  return {
    schemaVersion: 2,
    id: createActionId(),
    name: localize(type.title),
    typeId: type.id,
    enabled: true,
    config: defaultActionConfig(type),
  };
}

export function createEvent(name: string): LiveEvent {
  return {
    schemaVersion: 1,
    id: createEventId(),
    name,
    enabled: false,
    trigger: 'tiktok.gift',
    filters: [],
    cooldownMs: 0,
    cooldownScope: 'user',
    actionIds: [],
    runMode: 'all',
  };
}

export function describeAction(action: LiveAction): string {
  const config = action.config;
  switch (action.typeId) {
    case 'core.fetch': {
      const host = readString(config.url).replace(/^https?:\/\//, '').split('/')[0] ?? '';
      return `${readString(config.method)} ${host}`.trim();
    }
    case 'core.emit':
      return `emit ${readString(config.type)}`;
    case 'core.points':
      return `${readString(config.delta)} · ${readString(config.uniqueId)}`;
    case 'core.points.subtract':
      return `-${readString(config.amount)} · ${readString(config.uniqueId)}`;
    case 'core.delay':
      return `${readString(config.ms)} ms`;
    case 'core.log':
      return readString(config.message);
    case 'audio.play':
      return readString(config.file);
    default:
      return action.typeId;
  }
}

export function lastRunByAction(runs: readonly BehaviorRun[]): Map<string, BehaviorRun> {
  const map = new Map<string, BehaviorRun>();
  for (const run of runs) {
    if (run.test || !run.actionId || map.has(run.actionId)) continue;
    map.set(run.actionId, run);
  }
  return map;
}

export function triggerMessageKey(trigger: string): string {
  return `automations.triggers.${trigger.replace(/\./g, '-')}`;
}

export function isBuiltinTrigger(trigger: string): boolean {
  return (BEHAVIOR_TRIGGERS as readonly string[]).includes(trigger);
}

export interface TriggerOption {
  value: string;
  label: string;
  plugin?: string;
}

export function triggerOptions(
  eventTypes: readonly PluginEventType[],
  builtinLabel: (trigger: string) => string,
  localize: Localize,
): TriggerOption[] {
  return [
    ...BEHAVIOR_TRIGGERS.map((trigger) => ({ value: trigger, label: builtinLabel(trigger) })),
    ...eventTypes.map((entry) => ({
      value: entry.type,
      label: localize(entry.title),
      plugin: entry.source.kind === 'plugin' ? entry.source.pluginId : undefined,
    })),
  ];
}

export function triggerLabel(
  trigger: string,
  eventTypes: readonly PluginEventType[],
  builtinLabel: (trigger: string) => string,
  localize: Localize,
): string {
  if (isBuiltinTrigger(trigger)) return builtinLabel(trigger);
  const declared = eventTypes.find((entry) => entry.type === trigger);
  return declared ? localize(declared.title) : trigger;
}

export function actionNames(event: LiveEvent, actions: readonly LiveAction[]): string[] {
  return event.actionIds
    .map((id) => actions.find((action) => action.id === id)?.name)
    .filter((name): name is string => Boolean(name));
}

export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

export function moveId(ids: readonly string[], id: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
