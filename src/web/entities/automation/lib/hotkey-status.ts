import type {
  HotkeyBackendCapabilities,
  HotkeyBackendStatus,
  HotkeyStatusData,
} from '../../../../shared/messages.ts';

export type { HotkeyBackendCapabilities, HotkeyBackendStatus, HotkeyStatusData } from '../../../../shared/messages.ts';

export interface HotkeyStatusSummary {
  headline: string;
  chordsSupported: boolean;
  sequencesSupported: boolean;
  needsPermission: boolean;
  needsAttention: boolean;
  lines: string[];
}

const ACTIVE = new Set(['active', 'running']);
const PERMISSION = new Set(['permission required', 'permission-required']);

function capsOf(entry: HotkeyBackendStatus): HotkeyBackendCapabilities {
  const fallback = entry.backend !== 'portal';
  return {
    globalChords: entry.capabilities?.globalChords ?? fallback,
    arbitraryKeys: entry.capabilities?.arbitraryKeys ?? fallback,
    sequences: entry.capabilities?.sequences ?? fallback,
    keyRelease: entry.capabilities?.keyRelease ?? fallback,
  };
}

export type HotkeyListenerState =
  | 'active'
  | 'starting'
  | 'permission'
  | 'failed'
  | 'unsupported'
  | 'unknown';

export function hotkeyListenerState(
  data: HotkeyStatusData | null | undefined,
): HotkeyListenerState {
  if (!data || !Array.isArray(data.backends) || data.backends.length === 0) return 'unknown';
  const states = new Set(data.backends.map((entry) => entry.state));
  if (data.backends.some((entry) => PERMISSION.has(entry.state))) return 'permission';
  if (data.backends.some((entry) => entry.state === 'failed')) return 'failed';
  if ([...states].every((state) => state === 'unsupported')) return 'unsupported';
  if (data.backends.some((entry) => ACTIVE.has(entry.state))) return 'active';
  return 'starting';
}

export function hotkeyNeedsSeatAccess(
  data: HotkeyStatusData | null | undefined,
): boolean {
  if (!data || !Array.isArray(data.backends)) return false;
  return data.backends.some(
    (entry) =>
      (entry.state === 'failed' || PERMISSION.has(entry.state)) &&
      (entry.detail || '').includes('/dev/input'),
  );
}

export function formatHotkeyChord(key: string, modifiers: string): string {
  const parts = [...modifiers.split('+').filter(Boolean), key].filter(Boolean);
  return parts
    .map((part) => (part.length <= 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('+');
}

export function summarizeHotkeyStatus(data: HotkeyStatusData | null | undefined): HotkeyStatusSummary {
  if (!data || !Array.isArray(data.backends) || data.backends.length === 0) {
    return {
      headline: 'Global Hotkeys: status unknown',
      chordsSupported: false,
      sequencesSupported: false,
      needsPermission: false,
      needsAttention: false,
      lines: [],
    };
  }
  const running = data.backends.filter((entry) => ACTIVE.has(entry.state));
  const chordsSupported = running.some((entry) => capsOf(entry).globalChords);
  const sequencesSupported = running.some((entry) => capsOf(entry).sequences);
  const needsPermission = data.backends.some((entry) => PERMISSION.has(entry.state));
  const isConfigDisabled = (entry: HotkeyBackendStatus): boolean =>
    entry.state === 'unsupported' && (entry.detail || '').includes('sequencesNeeded=false');
  const actionable = data.backends.filter((entry) => {
    if (PERMISSION.has(entry.state)) return true;
    if (isConfigDisabled(entry)) return false;
    return entry.state === 'failed' || entry.state === 'unsupported';
  });
  const uniqueLines = [...new Set(data.backends.map((entry) => entry.summary || `${entry.backend}: ${entry.state}`))];
  const headlineEntry = actionable[0] ?? running[0] ?? data.backends[0];
  const headline = headlineEntry
    ? (headlineEntry.summary || `Global Hotkeys: ${headlineEntry.state} via ${headlineEntry.backend}`)
    : 'Global Hotkeys: unavailable';
  return {
    headline,
    chordsSupported,
    sequencesSupported,
    needsPermission,
    needsAttention: actionable.length > 0
      || (running.length === 0 && data.backends.some((entry) => entry.state !== 'starting' && !isConfigDisabled(entry))),
    lines: uniqueLines,
  };
}

export function sequenceTriggerHint(
  status: HotkeyStatusSummary,
  requested: boolean,
): string | null {
  if (!requested) return null;
  if (status.sequencesSupported) return null;
  if (status.needsPermission) {
    return 'This trigger needs raw keyboard access on Wayland. Approve the automatic system authorization request to enable sequence triggers.';
  }
  return 'No running backend observes key sequences on this session.';
}

export function requiresRawHotkeyInput(
  filters: Array<{ path: string; operator: string; value: string }>,
): boolean {
  const key = filters.find(
    (filter) => filter.path === 'event.data.key' && filter.operator === 'eq' && filter.value.trim() !== '',
  );
  const modifiers = filters.find(
    (filter) => filter.path === 'event.data.modifiers' && filter.operator === 'eq',
  );
  if (!key || !modifiers || modifiers.value.trim() === '') return true;
  if (filters.some((filter) => filter.path === 'event.data.sequence')) return true;
  return filters.some((filter) => (
    filter.path === 'event.data.backend'
    && !(filter.operator === 'eq' && filter.value.trim().toLowerCase() === 'portal')
  ));
}

export function rawHotkeyInputHint(
  data: HotkeyStatusData | null | undefined,
  requested: boolean,
): string | null {
  if (!requested || data?.session !== 'wayland') return null;
  const summary = summarizeHotkeyStatus(data);
  if (summary.sequencesSupported) return null;
  if (summary.needsPermission) {
    return 'This trigger needs raw keyboard access on Wayland. Approve the automatic system authorization request to enable arbitrary key triggers.';
  }
  return 'This trigger needs raw keyboard access on Wayland. TikTools will request it automatically when the behavior is enabled.';
}
