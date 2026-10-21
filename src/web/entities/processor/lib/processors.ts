import type { AutomationEvent } from '../../../../automation/types.ts';
import { emulateEventForType } from '../../../../automation/event-emulation.ts';
import type {
  ProcessorStatusEntry,
  ProcessorStatusMetrics,
} from '../../../../shared/messages.ts';

export type ProcessorStatusTone = 'ok' | 'error' | 'off';

export function processorStatusTone(status: ProcessorStatusEntry['status']): ProcessorStatusTone {
  if (status === 'ready') return 'ok';
  if (status === 'circuit-open') return 'error';
  return 'off';
}

export type ProcessorMetricRow = { key: string; value: string };

export function processorMetricRows(metrics: ProcessorStatusMetrics): ProcessorMetricRow[] {
  return [
    { key: 'calls', value: `${metrics.calls}` },
    { key: 'successes', value: `${metrics.successes}` },
    { key: 'failures', value: `${metrics.failures}` },
    { key: 'timeouts', value: `${metrics.timeouts}` },
    { key: 'skippedCircuitOpen', value: `${metrics.skippedCircuitOpen}` },
    { key: 'skippedOverloaded', value: `${metrics.skippedOverloaded}` },
    { key: 'averageLatencyMs', value: `${metrics.averageLatencyMs} ms` },
    { key: 'maxLatencyMs', value: `${metrics.maxLatencyMs} ms` },
  ];
}

export function processorPreviewEvent(
  entry: ProcessorStatusEntry,
  lastEvent?: AutomationEvent | null,
): AutomationEvent {
  const [first] = entry.eventTypes;
  return emulateEventForType(first ?? 'tiktok.chat', lastEvent).event;
}
