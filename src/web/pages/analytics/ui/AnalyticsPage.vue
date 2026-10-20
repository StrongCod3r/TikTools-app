<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useConnectionStore } from '@/entities/connection/model/connection-store.ts';
import { isAnalyticsMetric, type AnalyticsMetric } from '@/entities/analytics/lib/analytics-metrics.ts';
import {
  analyticsRangeKeys,
  dayToIsoDate,
  formatDayDate,
  isoDateToDay,
  isSingleDaySpan,
  resolveAnalyticsRange,
  systemDay,
  type AnalyticsRangeKey,
} from '@/entities/analytics/lib/analytics-range.ts';
import { useAnalyticsStore } from '@/entities/analytics/model/analytics-store.ts';
import AnalyticsContributorsTable from '@/entities/analytics/ui/AnalyticsContributorsTable.vue';
import AnalyticsFacts from '@/entities/analytics/ui/AnalyticsFacts.vue';
import AnalyticsMetricStrip from '@/entities/analytics/ui/AnalyticsMetricStrip.vue';
import { debounce, loadViewState, saveViewState } from '@/shared/lib/view-state.ts';
import AnalyticsRangeBar from '@/features/select-analytics-range/ui/AnalyticsRangeBar.vue';
import BaseIconButton from '@/shared/ui/button/BaseIconButton.vue';
import BaseEmptyState from '@/shared/ui/empty-state/BaseEmptyState.vue';
import IconChart from '@/shared/ui/icon/icons/IconChart.vue';
import IconRefresh from '@/shared/ui/icon/icons/IconRefresh.vue';
import IconSearch from '@/shared/ui/icon/icons/IconSearch.vue';
import BasePanel from '@/shared/ui/panel/BasePanel.vue';
import type { TableSort } from '@/shared/ui/table/table-types.ts';
import BaseTextField from '@/shared/ui/text-field/BaseTextField.vue';
import AnalyticsActivityPanel from '@/widgets/analytics-activity/ui/AnalyticsActivityPanel.vue';

const { t, locale } = useI18n();
const connection = useConnectionStore();
const store = useAnalyticsStore();
const { summary, loading, error } = storeToRefs(store);

const saved = loadViewState().analytics;
const today = systemDay(Date.now());
const range = ref<AnalyticsRangeKey>(analyticsRangeKeys.includes(saved?.range as AnalyticsRangeKey) ? saved!.range! : '7d');
const metric = ref<AnalyticsMetric>(isAnalyticsMetric(saved?.metric) ? saved.metric : 'chats');
const query = ref(saved?.contributorQuery ?? '');
const customStart = ref(saved?.customStart ?? dayToIsoDate(today - 6));
const customEnd = ref(saved?.customEnd ?? dayToIsoDate(today));
const sort = ref<TableSort | null>(null);

const creator = computed(() => connection.activeCreator);
const span = computed(() => {
  const now = systemDay(Date.now());
  return resolveAnalyticsRange(range.value, now, {
    startDay: isoDateToDay(customStart.value) ?? now,
    endDay: isoDateToDay(customEnd.value) ?? now,
  });
});

const hasData = computed(() => {
  const data = summary.value;
  if (!data) return false;
  return (
    data.days.length > 0 ||
    data.topViewers.length > 0 ||
    data.sessions > 0 ||
    Object.values(data.totals).some((value) => value > 0) ||
    data.hours.some((row) => Object.values(row).some((value) => typeof value === 'number' && value > 0))
  );
});

const emptyDescription = computed(() => {
  const data = summary.value;
  if (data && isSingleDaySpan(data)) return t('analytics.empty.today', { date: formatDayDate(data.startDay, locale.value) });
  return t('analytics.empty.hint');
});

function refresh(): void {
  void store.load(creator.value, span.value);
}

watch([span, creator], refresh, { immediate: true });

const persist = debounce(() => {
  saveViewState('analytics', {
    range: range.value,
    metric: metric.value,
    contributorQuery: query.value,
    customStart: customStart.value,
    customEnd: customEnd.value,
  });
});
watch([range, metric, query, customStart, customEnd], persist);
</script>

<template>
  <div class="analytics-page">
    <header class="analytics-page__toolbar">
      <AnalyticsRangeBar
        v-model:range="range"
        v-model:start="customStart"
        v-model:end="customEnd"
      />
      <span class="analytics-page__spacer" />
      <span
        v-if="creator"
        class="analytics-page__creator"
      >@{{ creator.replace(/^@/, '') }}</span>
      <BaseIconButton
        :label="t('analytics.refresh')"
        :disabled="loading"
        @click="refresh"
      >
        <IconRefresh />
      </BaseIconButton>
    </header>

    <p
      v-if="error"
      class="analytics-page__error"
      role="alert"
    >
      {{ error }}
    </p>

    <BaseEmptyState
      v-if="!summary || !hasData"
      class="analytics-page__empty"
      :title="loading && !summary ? t('analytics.loading') : t('analytics.empty.title')"
      :description="loading && !summary ? undefined : emptyDescription"
    >
      <template #icon>
        <IconChart :size="32" />
      </template>
    </BaseEmptyState>

    <template v-else>
      <AnalyticsMetricStrip
        v-model="metric"
        :totals="summary.totals"
      />
      <div class="analytics-page__main">
        <AnalyticsActivityPanel
          class="analytics-page__activity"
          :summary="summary"
          :metric="metric"
        />
        <BasePanel :title="t('analytics.facts.title')">
          <AnalyticsFacts
            :totals="summary.totals"
            :sessions="summary.sessions"
          />
        </BasePanel>
      </div>
      <BasePanel
        class="analytics-page__contributors"
        :title="t('analytics.contributors.title')"
        flush
      >
        <template #actions>
          <BaseTextField
            v-model="query"
            class="analytics-page__search"
            type="search"
            size="sm"
            :placeholder="t('analytics.contributors.search')"
            :aria-label="t('analytics.contributors.search')"
          >
            <template #prefix>
              <IconSearch />
            </template>
          </BaseTextField>
        </template>
        <AnalyticsContributorsTable
          v-model:sort="sort"
          :viewers="summary.topViewers"
          :query="query"
        />
      </BasePanel>
    </template>
  </div>
</template>

<style scoped>
.analytics-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  min-height: 0;
  padding: var(--space-4);
  overflow-y: auto;
}

.analytics-page__toolbar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
}

.analytics-page__spacer {
  flex: 1;
}

.analytics-page__creator {
  color: var(--color-text-muted);
}

.analytics-page__error {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--color-danger);
  border-radius: var(--radius-sm);
  color: var(--color-danger-hover);
}

.analytics-page__empty {
  flex: 1;
  border: var(--border-width) solid var(--color-border-subtle);
  background: var(--color-bg-panel);
}

.analytics-page__main {
  display: grid;
  grid-template-columns: minmax(0, 2.2fr) minmax(240px, 1fr);
  gap: var(--space-4);
}

.analytics-page__contributors {
  flex: none;
  min-height: 240px;
}

.analytics-page__search {
  width: 220px;
}

@media (width < 1100px) {
  .analytics-page__main {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
