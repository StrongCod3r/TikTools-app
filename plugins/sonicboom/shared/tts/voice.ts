import type { TtsSettings } from './types.ts';

/** First usable voice from a loaded list, or '' when none is known. */
export function firstAvailableVoice(availableVoices: readonly string[]): string {
  return availableVoices.map((voice) => voice.trim()).find((voice) => voice.length > 0) ?? '';
}

/**
 * Voice priority: special-user voice → random voice → default voice →
 * first available voice. The trailing fallback matters: servers such as
 * SonicBoom 400 on a present-but-empty `voice=` param (their built-in
 * default only applies when the param is absent, which templates cannot
 * express), so an empty resolution must never be sent while voices are
 * known. Only when no voice list was ever loaded can '' still come out,
 * and then the server error names the problem.
 */
export function chooseVoice(
  settings: TtsSettings,
  specialVoice: string | undefined,
  availableVoices: readonly string[],
  randomFn: () => number = Math.random,
): string {
  const qualify = (v: string): string => v && !v.includes(':') && settings.providerId === 'supertonic' ? `supertonic:${v}` : v;
  const pool = availableVoices.filter(v => v.startsWith(`${settings.providerId}:`));
  const special = qualify((specialVoice ?? '').trim());
  if (pool.includes(special)) return special;
  if (settings.randomVoice && pool.length) return pool[Math.min(Math.max(Math.floor(randomFn() * pool.length), 0), pool.length - 1)] ?? '';
  const fallback = qualify(settings.defaultVoice.trim());
  return pool.includes(fallback) ? fallback : firstAvailableVoice(pool);
}
