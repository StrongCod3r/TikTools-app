<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatCount } from '@/shared/lib/intl.ts';
import {
  formatHourLabel,
  HOURS_PER_DAY,
  metricColor,
  stackableMetrics,
  type AnalyticsMetric,
  type MetricSeries,
} from '../lib/analytics-metrics.ts';
import { buildStackedBars } from '../lib/chart-geometry.ts';

const props = defineProps<{
  series: MetricSeries;
  metric: AnalyticsMetric;
}>();

const box = { width: 720, height: 220, pad: 16 };
const gridSteps = [0, 0.5, 1];
const tickHours = [0, 6, 12, 18, 23];

const { t, locale } = useI18n();
const viewersOnly = computed(() => props.metric === 'peakViewers');
const drawn = computed<readonly AnalyticsMetric[]>(() => (viewersOnly.value ? ['peakViewers'] : stackableMetrics));
const chart = computed(() =>
  buildStackedBars(
    drawn.value.map((metric) => ({ key: metric, values: props.series[metric] })),
    HOURS_PER_DAY,
    box,
  ),
);
const slot = (box.width - box.pad * 2) / HOURS_PER_DAY;
const label = (metric: string): string => t(`analytics.metrics.${metric}`);
</script>

<template>
  <div class="hourly-chart">
    <ul
      class="hourly-chart__legend"
      :aria-label="t('analytics.legend')"
    >
      <li
        v-for="entry in drawn"
        :key="entry"
        class="hourly-chart__legend-item"
        :class="{ 'hourly-chart__legend-item--active': entry === metric }"
      >
        <span
          class="hourly-chart__swatch"
          :style="{ background: metricColor[entry] }"
        />
        {{ label(entry) }}
      </li>
    </ul>
    <svg
      class="hourly-chart__svg"
      :viewBox="`0 0 ${box.width} ${box.height}`"
      role="img"
      :aria-label="`${label(metric)}: ${formatCount(chart.max, locale)}`"
    >
      <g
        v-for="step in gridSteps"
        :key="step"
      >
        <line
          class="hourly-chart__grid"
          :x1="box.pad"
          :x2="box.width - box.pad"
          :y1="box.pad + (box.height - box.pad * 2) * (1 - step)"
          :y2="box.pad + (box.height - box.pad * 2) * (1 - step)"
        />
        <text
          class="hourly-chart__tick"
          :x="box.width - box.pad"
          :y="box.pad + (box.height - box.pad * 2) * (1 - step) - 4"
          text-anchor="end"
        >{{ formatCount(chart.max * step, locale) }}</text>
      </g>
      <g
        v-for="bar in chart.bars"
        :key="bar.index"
      >
        <rect
          v-for="segment in bar.segments"
          :key="segment.key"
          :x="bar.x"
          :y="segment.y"
          :width="bar.width"
          :height="segment.height"
          :fill="metricColor[segment.key as AnalyticsMetric]"
          :opacity="segment.key === metric ? 0.95 : 0.3"
        >
          <title>{{ formatHourLabel(bar.index) }} — {{ label(segment.key) }}: {{ formatCount(segment.value, locale) }}</title>
        </rect>
      </g>
      <text
        v-for="hour in tickHours"
        :key="hour"
        class="hourly-chart__tick"
        :x="box.pad + slot * hour + slot / 2"
        :y="box.height - 2"
        :text-anchor="hour === 0 ? 'start' : hour === 23 ? 'end' : 'middle'"
      >{{ formatHourLabel(hour) }}</text>
    </svg>
    <p
      v-if="chart.max === 0"
      class="hourly-chart__empty"
    >
      {{ t('analytics.noHourlyData') }}
    </p>
  </div>
</template>

<style scoped>
.hourly-chart {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.hourly-chart__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
  margin: 0;
  padding: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  list-style: none;
}

.hourly-chart__legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.hourly-chart__legend-item--active {
  color: var(--color-text);
}

.hourly-chart__swatch {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-sm);
}

.hourly-chart__svg {
  display: block;
  width: 100%;
  height: auto;
}

.hourly-chart__grid {
  stroke: var(--color-chart-grid);
  stroke-width: 1;
}

.hourly-chart__tick {
  fill: var(--color-text-subtle);
  font-family: var(--font-family);
  font-size: 11px;
}

.hourly-chart__empty {
  margin: 0;
  color: var(--color-text-subtle);
  font-size: var(--font-size-sm);
  text-align: center;
}
</style>
