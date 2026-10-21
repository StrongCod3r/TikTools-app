import { intlLocale } from '@/shared/lib/intl.ts';

export type AnalyticsRangeKey = 'today' | '7d' | '30d' | '90d' | 'custom';

export const analyticsRangeKeys: readonly AnalyticsRangeKey[] = ['today', '7d', '30d', '90d', 'custom'];

export interface AnalyticsDaySpan {
  startDay: number;
  endDay: number;
}

const DAY_MS = 86_400_000;

const presetLengths: Record<Exclude<AnalyticsRangeKey, 'custom'>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function systemDay(unixMs: number): number {
  const date = new Date(unixMs);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

export function tzOffsetSecsForDay(day: number): number {
  return -new Date(day * DAY_MS + DAY_MS / 2).getTimezoneOffset() * 60;
}

export function resolveAnalyticsRange(
  range: AnalyticsRangeKey,
  today: number,
  custom?: AnalyticsDaySpan,
): AnalyticsDaySpan {
  if (range !== 'custom') return { startDay: today - presetLengths[range] + 1, endDay: today };
  const start = custom?.startDay ?? today;
  const end = custom?.endDay ?? today;
  return start <= end ? { startDay: start, endDay: end } : { startDay: end, endDay: start };
}

export function isSingleDaySpan(span: AnalyticsDaySpan): boolean {
  return span.endDay <= span.startDay;
}

export function dayToIsoDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function isoDateToDay(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, date);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return null;
  return Math.floor(ms / DAY_MS);
}

export function formatDayLabel(day: number, locale: string): string {
  return new Date(day * DAY_MS).toLocaleDateString(intlLocale(locale), { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatDayDate(day: number, locale: string): string {
  return new Date(day * DAY_MS).toLocaleDateString(intlLocale(locale), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatSpan(span: AnalyticsDaySpan, locale: string): string {
  return isSingleDaySpan(span)
    ? formatDayDate(span.startDay, locale)
    : `${formatDayDate(span.startDay, locale)} – ${formatDayDate(span.endDay, locale)}`;
}

export function formatZoneShort(locale: string): string {
  try {
    const parts = new Intl.DateTimeFormat(intlLocale(locale), {
      timeZone: systemTimeZone(),
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

export function formatClockTime(unixSecs: number, locale: string): string {
  if (!Number.isFinite(unixSecs) || unixSecs <= 0) return '—';
  return new Date(unixSecs * 1_000).toLocaleTimeString(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: systemTimeZone(),
  });
}
