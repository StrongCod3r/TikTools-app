<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ViewerRecord } from '../../../../shared/messages.ts';
import { formatCount } from '@/shared/lib/intl.ts';
import BaseTable from '@/shared/ui/table/BaseTable.vue';
import type { TableSort } from '@/shared/ui/table/table-types.ts';
import { filterViewers, rankViewers, sortViewers, type LeaderboardSortKey, type RankedViewer } from '../lib/leaderboard.ts';

const props = defineProps<{
  viewers: readonly ViewerRecord[];
  query: string;
  currency: string;
}>();

const sort = defineModel<TableSort | null>('sort', { default: null });
const selected = defineModel<string | null>('selected', { default: null });
const { t, locale } = useI18n();

const columns = computed(() => [
  { key: 'rank', label: t('points.leaderboard.rank'), width: '64px', sortable: true },
  { key: 'uniqueId', label: t('points.leaderboard.viewer'), sortable: true },
  { key: 'level', label: t('points.leaderboard.level'), width: '80px', align: 'end' as const, sortable: true },
  { key: 'points', label: props.currency, width: '120px', align: 'end' as const, sortable: true },
  { key: 'actions', label: '', width: '44px', align: 'center' as const },
]);

const rows = computed(() => {
  const filtered = filterViewers(rankViewers(props.viewers), props.query);
  return sort.value ? sortViewers(filtered, sort.value.key as LeaderboardSortKey, sort.value.direction) : filtered;
});

defineExpose({ count: computed(() => rows.value.length) });
</script>

<template>
  <BaseTable
    v-model:sort="sort"
    v-model:selected="selected"
    class="leaderboard-table"
    :columns="columns"
    :rows="rows"
    :row-key="(row: RankedViewer) => row.uniqueId"
    selectable
  >
    <template #cell-rank="{ row }">
      <span
        class="leaderboard-table__rank"
        :class="{ 'leaderboard-table__rank--podium': row.rank <= 3 }"
      >#{{ row.rank }}</span>
    </template>
    <template #cell-uniqueId="{ row }">
      <span class="leaderboard-table__viewer">
        <span>@{{ row.uniqueId }}</span>
        <span
          v-if="row.nickname"
          class="leaderboard-table__nickname"
        >{{ row.nickname }}</span>
        <span
          v-if="row.isSubscriber"
          class="leaderboard-table__badge"
        >{{ t('points.leaderboard.subscriber') }}</span>
      </span>
    </template>
    <template #cell-level="{ row }">
      {{ row.level }}
    </template>
    <template #cell-points="{ row }">
      <span class="leaderboard-table__points">{{ formatCount(row.points, locale) }}</span>
    </template>
    <template #cell-actions="{ row }">
      <slot
        name="actions"
        :viewer="row"
      />
    </template>
    <template #empty>
      {{ query ? t('points.leaderboard.noMatches') : t('points.leaderboard.empty') }}
    </template>
  </BaseTable>
</template>

<style scoped>
.leaderboard-table__rank {
  color: var(--color-text-subtle);
  font-variant-numeric: tabular-nums;
}

.leaderboard-table__rank--podium {
  color: var(--color-chart-3);
  font-weight: var(--font-weight-semibold);
}

.leaderboard-table__viewer {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.leaderboard-table__nickname {
  overflow: hidden;
  color: var(--color-text-muted);
  text-overflow: ellipsis;
}

.leaderboard-table__badge {
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--color-chart-3);
  border-radius: var(--radius-sm);
  color: var(--color-chart-3);
  font-size: var(--font-size-xs);
}

.leaderboard-table__points {
  font-weight: var(--font-weight-semibold);
}
</style>
