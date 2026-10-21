<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AnalyticsTotals } from '../../../../shared/messages.ts';
import { useRovingSelection } from '@/shared/lib/use-roving-selection.ts';
import { formatCount } from '@/shared/lib/intl.ts';
import { analyticsMetrics, metricColor, totalFor, type AnalyticsMetric } from '../lib/analytics-metrics.ts';

const props = defineProps<{
  totals: AnalyticsTotals;
}>();

const model = defineModel<AnalyticsMetric>({ required: true });
const { t, locale } = useI18n();

const items = computed(() =>
  analyticsMetrics.map((metric) => ({
    metric,
    label: t(`analytics.metrics.${metric}`),
    value: formatCount(totalFor(props.totals, metric), locale.value),
  })),
);
const selectedIndex = computed(() => analyticsMetrics.indexOf(model.value));
const { focusIndex, select, onKeydown, setElement } = useRovingSelection(items, selectedIndex, (index) => {
  model.value = analyticsMetrics[index]!;
});
</script>

<template>
  <div
    class="metric-strip"
    role="radiogroup"
    :aria-label="t('analytics.metricPicker')"
    @keydown="onKeydown"
  >
    <button
      v-for="(item, index) in items"
      :key="item.metric"
      :ref="(element) => setElement(index, element)"
      class="metric-strip__tile"
      type="button"
      role="radio"
      :aria-checked="index === selectedIndex"
      :tabindex="index === focusIndex ? 0 : -1"
      :style="{ '--metric-color': metricColor[item.metric] }"
      @click="select(index)"
    >
      <span class="metric-strip__label">{{ item.label }}</span>
      <span class="metric-strip__value">{{ item.value }}</span>
    </button>
  </div>
</template>

<style scoped>
.metric-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-2);
}

.metric-strip__tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-bg-panel);
  color: var(--color-text);
  font-family: var(--font-family);
  text-align: left;
  cursor: pointer;
  outline: none;
  transform: none;
}

.metric-strip__tile::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 2px;
  background: var(--metric-color);
  opacity: 0.45;
  content: '';
}

.metric-strip__tile:hover {
  background: var(--color-bg-raised);
}

.metric-strip__tile[aria-checked='true'] {
  border-color: var(--metric-color);
  background: var(--color-bg-raised);
}

.metric-strip__tile[aria-checked='true']::before {
  opacity: 1;
}

.metric-strip__tile:focus-visible {
  box-shadow: var(--focus-ring);
}

.metric-strip__label {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-strip__value {
  font-size: 20px;
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  line-height: var(--line-height-tight);
}
</style>
