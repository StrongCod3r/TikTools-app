<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AnalyticsTopViewer } from '../../../../shared/messages.ts';
import BaseTable from '@/shared/ui/table/BaseTable.vue';
import type { TableSort } from '@/shared/ui/table/table-types.ts';
import { formatCount } from '@/shared/lib/intl.ts';
import { formatClockTime } from '../lib/analytics-range.ts';
import {
  filterContributors,
  rankContributors,
  sortContributors,
  type ContributorSortKey,
  type RankedContributor,
} from '../lib/contributors.ts';

const props = defineProps<{
  viewers: readonly AnalyticsTopViewer[];
  query: string;
}>();

const sort = defineModel<TableSort | null>('sort', { default: null });
const { t, locale } = useI18n();

const columns = computed(() => [
  { key: 'rank', label: t('analytics.contributors.rank'), width: '64px', sortable: true },
  { key: 'uniqueId', label: t('analytics.contributors.viewer'), sortable: true },
  { key: 'chats', label: t('analytics.metrics.chats'), width: '96px', align: 'end' as const, sortable: true },
  { key: 'gifts', label: t('analytics.metrics.gifts'), width: '96px', align: 'end' as const, sortable: true },
  { key: 'diamonds', label: t('analytics.metrics.diamonds'), width: '104px', align: 'end' as const, sortable: true },
  {
    key: 'interactions',
    label: t('analytics.contributors.interactions'),
    width: '120px',
    align: 'end' as const,
    sortable: true,
  },
  { key: 'lastSeen', label: t('analytics.contributors.lastActive'), width: '112px', align: 'end' as const, sortable: true },
]);

const rows = computed(() => {
  const filtered = filterContributors(rankContributors(props.viewers), props.query);
  return sort.value ? sortContributors(filtered, sort.value.key as ContributorSortKey, sort.value.direction) : filtered;
});
</script>

<template>
  <BaseTable
    v-model:sort="sort"
    class="contributors-table"
    :columns="columns"
    :rows="rows"
    :row-key="(row: RankedContributor) => row.uniqueId"
  >
    <template #cell-rank="{ value }">
      <span
        class="contributors-table__rank"
        :class="{ 'contributors-table__rank--podium': Number(value) <= 3 }"
      >#{{ value }}</span>
    </template>
    <template #cell-uniqueId="{ value }">
      @{{ value }}
    </template>
    <template #cell-chats="{ value }">
      {{ formatCount(Number(value), locale) }}
    </template>
    <template #cell-gifts="{ value }">
      {{ formatCount(Number(value), locale) }}
    </template>
    <template #cell-diamonds="{ value }">
      {{ formatCount(Number(value), locale) }}
    </template>
    <template #cell-interactions="{ value }">
      {{ formatCount(Number(value), locale) }}
    </template>
    <template #cell-lastSeen="{ value }">
      {{ formatClockTime(Number(value), locale) }}
    </template>
    <template #empty>
      {{ query ? t('analytics.contributors.noMatches') : t('analytics.contributors.empty') }}
    </template>
  </BaseTable>
</template>

<style scoped>
.contributors-table__rank {
  color: var(--color-text-subtle);
  font-variant-numeric: tabular-nums;
}

.contributors-table__rank--podium {
  color: var(--color-chart-3);
  font-weight: var(--font-weight-semibold);
}
</style>
