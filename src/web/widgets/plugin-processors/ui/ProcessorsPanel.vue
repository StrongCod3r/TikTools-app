<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PluginStatus } from '../../../../automation/behavior/types.ts';
import type { ProcessorStatusEntry } from '../../../../shared/messages.ts';
import { processorMetricRows, processorPreviewEvent, processorStatusTone } from '@/entities/processor/lib/processors.ts';
import { useProcessorsStore } from '@/entities/processor/model/processors-store.ts';
import { localizedText } from '@/shared/i18n/i18n.ts';
import { formatCount } from '@/shared/lib/intl.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BaseIconButton from '@/shared/ui/button/BaseIconButton.vue';
import BaseEmptyState from '@/shared/ui/empty-state/BaseEmptyState.vue';
import IconFlow from '@/shared/ui/icon/icons/IconFlow.vue';
import IconRefresh from '@/shared/ui/icon/icons/IconRefresh.vue';
import IconSearch from '@/shared/ui/icon/icons/IconSearch.vue';
import BasePanel from '@/shared/ui/panel/BasePanel.vue';
import BaseTable from '@/shared/ui/table/BaseTable.vue';
import type { TableColumn } from '@/shared/ui/table/table-types.ts';
import BaseTextField from '@/shared/ui/text-field/BaseTextField.vue';
import { filterProcessors, processorKey } from '../lib/processor-rows.ts';

const props = defineProps<{
  plugins: readonly PluginStatus[];
}>();

const query = defineModel<string>('query', { default: '' });

const { t, locale } = useI18n();
const store = useProcessorsStore();
const { processors, test, testing, error } = storeToRefs(store);
const selected = ref<string | null>(null);

const columns = computed<TableColumn[]>(() => [
  { key: 'processorId', label: t('plugins.processors.columns.processor') },
  { key: 'plugin', label: t('plugins.processors.columns.plugin') },
  { key: 'status', label: t('plugins.processors.columns.status'), width: '130px' },
  { key: 'events', label: t('plugins.processors.columns.events') },
  { key: 'calls', label: t('plugins.processors.columns.calls'), width: '80px', align: 'end' },
  { key: 'latency', label: t('plugins.processors.columns.latency'), width: '110px', align: 'end' },
]);

const rows = computed(() => filterProcessors(processors.value, query.value));
const current = computed(() => processors.value.find((entry) => processorKey(entry) === selected.value) ?? null);
const currentTest = computed(() => {
  const entry = current.value;
  const outcome = test.value;
  return entry && outcome && outcome.pluginId === entry.pluginId && outcome.processorId === entry.processorId ? outcome : null;
});
const currentFacts = computed(() => {
  const entry = current.value;
  if (!entry) return [];
  return [
    { key: 'plugin', label: t('plugins.processors.columns.plugin'), value: pluginName(entry.pluginId) },
    { key: 'events', label: t('plugins.processors.columns.events'), value: eventsLabel(entry), mono: true },
    { key: 'timeout', label: t('plugins.processors.timeout'), value: t('plugins.processors.milliseconds', { value: entry.timeoutMs }) },
    { key: 'priority', label: t('plugins.processors.priority'), value: String(entry.priority) },
    ...processorMetricRows(entry.metrics).map((metric) => ({
      key: metric.key,
      label: t(`plugins.processors.metrics.${metric.key}`),
      value: metric.value,
    })),
  ];
});

function pluginName(pluginId: string): string {
  const plugin = props.plugins.find((entry) => entry.descriptor.id === pluginId);
  return plugin ? localizedText(plugin.descriptor.name) : pluginId;
}

function eventsLabel(entry: ProcessorStatusEntry): string {
  return entry.eventTypes.length ? entry.eventTypes.join(', ') : t('plugins.processors.allEvents');
}

function runTest(entry: ProcessorStatusEntry): void {
  void store.runTest(entry.pluginId, entry.processorId, processorPreviewEvent(entry));
}

onMounted(() => void store.refresh());
</script>

<template>
  <div class="processors">
    <BasePanel
      class="processors__list"
      :title="t('plugins.views.processors')"
      flush
    >
      <template #actions>
        <BaseTextField
          v-model="query"
          class="processors__search"
          type="search"
          size="sm"
          :placeholder="t('plugins.processors.search')"
          :aria-label="t('plugins.processors.search')"
        >
          <template #prefix>
            <IconSearch />
          </template>
        </BaseTextField>
        <BaseIconButton
          :label="t('plugins.processors.refresh')"
          size="sm"
          @click="store.refresh()"
        >
          <IconRefresh />
        </BaseIconButton>
      </template>
      <p
        v-if="error"
        class="processors__error"
        role="alert"
      >
        {{ error }}
      </p>
      <BaseTable
        v-model:selected="selected"
        class="processors__table"
        :columns="columns"
        :rows="rows"
        :row-key="processorKey"
        selectable
      >
        <template #cell-processorId="{ row }">
          <span class="processors__mono">{{ row.processorId }}</span>
        </template>
        <template #cell-plugin="{ row }">
          {{ pluginName(row.pluginId) }}
        </template>
        <template #cell-status="{ row }">
          <span
            class="processors__status"
            :class="`processors__status--${processorStatusTone(row.status)}`"
          >
            <span
              class="processors__dot"
              aria-hidden="true"
            />
            {{ t(`plugins.processors.status.${row.status}`) }}
          </span>
        </template>
        <template #cell-events="{ row }">
          <span class="processors__events">{{ eventsLabel(row) }}</span>
        </template>
        <template #cell-calls="{ row }">
          {{ formatCount(row.metrics.calls, locale) }}
        </template>
        <template #cell-latency="{ row }">
          {{ t('plugins.processors.milliseconds', { value: row.metrics.averageLatencyMs }) }}
        </template>
        <template #empty>
          <BaseEmptyState
            v-if="query.trim()"
            :title="t('plugins.processors.noMatches', { query: query.trim() })"
          />
          <BaseEmptyState
            v-else
            :title="t('plugins.processors.empty')"
            :description="t('plugins.processors.emptyHint')"
          >
            <template #icon>
              <IconFlow :size="28" />
            </template>
          </BaseEmptyState>
        </template>
      </BaseTable>
    </BasePanel>

    <BasePanel
      class="processors__detail"
      :title="current ? current.processorId : t('plugins.processors.columns.processor')"
    >
      <div
        v-if="!current"
        class="processors__hint"
      >
        <p>{{ t('plugins.processors.select') }}</p>
        <p>{{ t('plugins.processors.lead') }}</p>
      </div>
      <div
        v-else
        class="processors__body"
      >
        <dl class="processors__facts">
          <div
            v-for="fact in currentFacts"
            :key="fact.key"
            class="processors__fact"
          >
            <dt>{{ fact.label }}</dt>
            <dd :class="{ processors__mono: fact.mono }">
              {{ fact.value }}
            </dd>
          </div>
        </dl>
        <section
          v-if="current.metrics.lastError"
          class="processors__last-error"
        >
          <h3>{{ t('plugins.processors.lastError') }}</h3>
          <p>{{ current.metrics.lastError }}</p>
        </section>
        <BaseButton
          :disabled="testing !== null"
          @click="runTest(current)"
        >
          {{ testing === selected ? t('plugins.processors.testing') : t('plugins.processors.test') }}
        </BaseButton>
        <section
          v-if="currentTest"
          class="processors__test"
          :class="{ 'processors__test--failed': !currentTest.ok }"
          role="status"
        >
          <h3>
            {{
              currentTest.ok
                ? t('plugins.processors.testOk', { ms: currentTest.durationMs })
                : t('plugins.processors.testFailed', { ms: currentTest.durationMs })
            }}
          </h3>
          <p v-if="currentTest.error">
            {{ currentTest.error }}
          </p>
          <pre class="processors__result">{{ JSON.stringify(currentTest.result, null, 2) }}</pre>
        </section>
      </div>
    </BasePanel>
  </div>
</template>

<style scoped>
.processors {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: var(--space-4);
  min-width: 0;
  min-height: 0;
}

.processors__search {
  width: 220px;
}

.processors__error {
  margin: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--color-danger);
  border-radius: var(--radius-sm);
  color: var(--color-danger-hover);
}

.processors__table {
  height: 100%;
}

.processors__mono {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
}

.processors__events {
  display: block;
  overflow: hidden;
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.processors__status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.processors__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-text-subtle);
}

.processors__status--ok .processors__dot {
  background: var(--color-success);
}

.processors__status--error {
  color: var(--color-danger-hover);
}

.processors__status--error .processors__dot {
  background: var(--color-danger);
}

.processors__hint {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  color: var(--color-text-subtle);
}

.processors__hint p {
  margin: 0;
}

.processors__body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-5);
}

.processors__facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-4) var(--space-5);
  align-self: stretch;
  margin: 0;
}

.processors__fact {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.processors__fact dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.processors__fact dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.processors__last-error,
.processors__test {
  align-self: stretch;
  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-sm);
}

.processors__last-error {
  border-color: var(--color-danger);
}

.processors__test--failed {
  border-color: var(--color-danger);
}

.processors__last-error h3,
.processors__test h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
}

.processors__last-error p,
.processors__test p {
  margin: 0 0 var(--space-2);
  color: var(--color-danger-hover);
  overflow-wrap: anywhere;
}

.processors__result {
  max-height: 280px;
  margin: 0;
  padding: var(--space-3);
  overflow: auto;
  border-radius: var(--radius-sm);
  background: var(--color-bg-field);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
  white-space: pre-wrap;
}

@media (width < 1280px) {
  .processors {
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
