export interface SpinRange {
  min?: number;
  max?: number;
  step: number;
  precision: number;
}

export function precisionOf(step: number): number {
  const [, decimals = ''] = String(step).split('.');
  return decimals.length;
}

export function normalizeSpinValue(value: number, range: SpinRange): number {
  const min = range.min ?? -Infinity;
  const max = range.max ?? Infinity;
  const clamped = Math.min(Math.max(value, min), max);
  return Number(clamped.toFixed(range.precision));
}

export function stepSpinValue(value: number, direction: number, range: SpinRange): number {
  return normalizeSpinValue(value + direction * range.step, range);
}

export function parseSpinValue(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '' || normalized === '-' || normalized === '.') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function formatSpinValue(value: number, precision: number): string {
  return value.toFixed(precision);
}
