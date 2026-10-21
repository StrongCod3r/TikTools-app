import type { ProcessorStatusEntry } from '../../../../shared/messages.ts';

export function processorKey(entry: ProcessorStatusEntry): string {
  return `${entry.pluginId}/${entry.processorId}`;
}

export function filterProcessors(entries: readonly ProcessorStatusEntry[], query: string): ProcessorStatusEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((entry) => {
    const haystack = `${entry.pluginId} ${entry.processorId} ${entry.status} ${entry.eventTypes.join(' ')}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
