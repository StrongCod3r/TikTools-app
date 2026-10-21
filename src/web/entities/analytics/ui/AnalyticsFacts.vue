<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AnalyticsTotals } from '../../../../shared/messages.ts';
import { formatCount } from '@/shared/lib/intl.ts';

const props = defineProps<{
  totals: AnalyticsTotals;
  sessions: number;
}>();

const { t, locale } = useI18n();

const facts = computed(() =>
  (
    [
      ['sessions', props.sessions],
      ['peakViewers', props.totals.peakViewers],
      ['giftEvents', props.totals.giftEvents],
      ['likeEvents', props.totals.likeEvents],
      ['follows', props.totals.follows],
      ['shares', props.totals.shares],
      ['joins', props.totals.joins],
    ] as const
  ).map(([key, value]) => ({ key, label: t(`analytics.facts.${key}`), value: formatCount(value, locale.value) })),
);
</script>

<template>
  <dl class="analytics-facts">
    <div
      v-for="fact in facts"
      :key="fact.key"
      class="analytics-facts__row"
    >
      <dt>{{ fact.label }}</dt>
      <dd>{{ fact.value }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.analytics-facts {
  margin: 0;
}

.analytics-facts__row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-5);
  padding: var(--space-3) var(--space-1);
}

.analytics-facts__row + .analytics-facts__row {
  border-top: var(--border-width) solid var(--color-border-subtle);
}

.analytics-facts dt {
  color: var(--color-text-muted);
}

.analytics-facts dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-weight: var(--font-weight-semibold);
}
</style>
