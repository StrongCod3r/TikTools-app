import type { ActionOptionItem } from '../types.ts';

export type VoiceOption = { value: string; label: string };

/** Only catalog-authorized voices may appear in a provider-scoped dropdown. */
export function voiceOptions(voices: ActionOptionItem[]): VoiceOption[] {
  const options = voices.map((voice) => ({ value: voice.value, label: voice.label || voice.value }));
  return options;
}
