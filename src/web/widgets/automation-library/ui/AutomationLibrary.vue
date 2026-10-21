<script setup lang="ts">
import { computed } from 'vue';
import type { ActionTypeDefinition, BehaviorRun, LiveAction, LiveEvent, PluginEventType } from '../../../../automation/behavior/types.ts';
import {
  actionNames,
  actionTypeOf,
  describeAction,
  lastRunByAction,
  matchesQuery,
  recordSorts,
  sortRecords,
  type RecordSort,
} from '@/entities/automation/lib/automation-records.ts';
import { useAutomationText } from '@/entities/automation/model/use-automation-text.ts';
import { formatClockTime } from '@/entities/analytics/lib/analytics-range.ts';
import { localizedText } from '@/shared/i18n/i18n.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BaseCheckbox from '@/shared/ui/checkbox/BaseCheckbox.vue';
import BaseComboBox from '@/shared/ui/combo-box/BaseComboBox.vue';
import BaseEmptyState from '@/shared/ui/empty-state/BaseEmptyState.vue';
import IconFlow from '@/shared/ui/icon/icons/IconFlow.vue';
import IconPlus from '@/shared/ui/icon/icons/IconPlus.vue';
import IconSearch from '@/shared/ui/icon/icons/IconSearch.vue';
import BaseTable from '@/shared/ui/table/BaseTable.vue';
import type { TableColumn } from '@/shared/ui/table/table-types.ts';
import BaseTabs from '@/shared/ui/tabs/BaseTabs.vue';
import BaseTextField from '@/shared/ui/text-field/BaseTextField.vue';
import type { LibraryTab } from '../model/library-tab.ts';

const props = defineProps<{
  events: readonly LiveEvent[];
  actions: readonly LiveAction[];
  actionTypes: readonly ActionTypeDefinition[];
  availableTypes: ReadonlySet<string>;
  eventTypes: readonly PluginEventType[];
  runs: readonly BehaviorRun[];
}>();

const emit = defineEmits<{
  newEvent: [];
  newAction: [];
  setEnabled: [kind: LibraryTab, id: string, enabled: boolean];
}>();

const tab = defineModel<LibraryTab>('tab', { required: true });
const selected = defineModel<string | null>('selected', { default: null });
const eventQuery = defineModel<string>('eventQuery', { default: '' });
const actionQuery = defineModel<string>('actionQuery', { default: '' });
const eventSort = defineModel<RecordSort>('eventSort', { default: 'name' });
const actionSort = defineModel<RecordSort>('actionSort', { default: 'name' });

const { t, locale, triggerName } = useAutomationText();

const tabs = computed(() => [
  { value: 'events' as const, label: `${t('automations.library.events')} (${props.events.length})` },
  { value: 'actions' as const, label: `${t('automations.library.actions')} (${props.actions.length})` },
]);
const sortOptions = computed(() => recordSorts.map((sort) => ({ value: sort, label: t(`automations.library.sorts.${sort}`) })));

const eventColumns = computed<TableColumn[]>(() => [
  { key: 'enabled', label: t('automations.library.columns.enabled'), width: '56px', align: 'center' },
  { key: 'name', label: t('automations.library.columns.name') },
  { key: 'trigger', label: t('automations.library.columns.trigger') },
  { key: 'actions', label: t('automations.library.columns.actions') },
]);
const actionColumns = computed<TableColumn[]>(() => [
  { key: 'enabled', label: t('automations.library.columns.enabled'), width: '56px', align: 'center' },
  { key: 'name', label: t('automations.library.columns.name') },
  { key: 'type', label: t('automations.library.columns.type') },
  { key: 'lastRun', label: t('automations.library.columns.lastRun'), width: '110px', align: 'end' },
]);

const eventRows = computed(() =>
  sortRecords(props.events, eventSort.value)
    .map((event) => ({
      id: event.id,
      name: event.name,
      enabled: event.enabled,
      trigger: triggerName(event.trigger, props.eventTypes),
      conditions: t('automations.library.conditionCount', event.filters.length),
      actions: actionNames(event, props.actions),
    }))
    .filter((row) => matchesQuery(eventQuery.value, row.name, row.trigger, ...row.actions)),
);

const lastRuns = computed(() => lastRunByAction(props.runs));
const actionRows = computed(() =>
  sortRecords(props.actions, actionSort.value)
    .map((action) => {
      const type = actionTypeOf(action, props.actionTypes);
      const run = lastRuns.value.get(action.id);
      return {
        id: action.id,
        name: action.name,
        enabled: action.enabled,
        type: type ? localizedText(type.title) : action.typeId,
        detail: describeAction(action),
        missing: !props.availableTypes.has(action.typeId),
        lastRun: run ? formatClockTime(run.at / 1000, locale.value) : t('automations.library.never'),
        failed: run?.status === 'error',
      };
    })
    .filter((row) => matchesQuery(actionQuery.value, row.name, row.type, row.detail)),
);

const query = computed({
  get: () => (tab.value === 'events' ? eventQuery.value : actionQuery.value),
  set: (value: string) => {
    if (tab.value === 'events') eventQuery.value = value;
    else actionQuery.value = value;
  },
});
const sort = computed({
  get: () => (tab.value === 'events' ? eventSort.value : actionSort.value),
  set: (value: RecordSort | undefined) => {
    if (!value) return;
    if (tab.value === 'events') eventSort.value = value;
    else actionSort.value = value;
  },
});
</script>

<template>
  <section
    class="automation-library"
    :aria-label="t('automations.library.events')"
  >
    <BaseTabs
      v-model="tab"
      class="automation-library__tabs"
      :tabs="tabs"
    >
      <div class="automation-library__pane">
        <div class="automation-library__toolbar">
          <BaseTextField
            v-model="query"
            class="automation-library__search"
            type="search"
            size="sm"
            :placeholder="tab === 'events' ? t('automations.library.searchEvents') : t('automations.library.searchActions')"
            :aria-label="tab === 'events' ? t('automations.library.searchEvents') : t('automations.library.searchActions')"
          >
            <template #prefix>
              <IconSearch />
            </template>
          </BaseTextField>
          <BaseComboBox
            v-model="sort"
            class="automation-library__sort"
            :options="sortOptions"
            size="sm"
            :aria-label="t('automations.library.sort')"
          />
          <BaseButton
            size="sm"
            variant="primary"
            @click="tab === 'events' ? emit('newEvent') : emit('newAction')"
          >
            <template #icon>
              <IconPlus />
            </template>
            {{ tab === 'events' ? t('automations.library.newEvent') : t('automations.library.newAction') }}
          </BaseButton>
        </div>
        <BaseTable
          v-if="tab === 'events'"
          v-model:selected="selected"
          class="automation-library__table"
          :columns="eventColumns"
          :rows="eventRows"
          :row-key="(row) => row.id"
          selectable
        >
          <template #cell-enabled="{ row }">
            <BaseCheckbox
              :model-value="row.enabled"
              :aria-label="t('automations.library.enable', { name: row.name })"
              @update:model-value="emit('setEnabled', 'events', row.id, $event)"
            />
          </template>
          <template #cell-name="{ row }">
            <span class="automation-library__name">{{ row.name }}</span>
            <span class="automation-library__sub">{{ row.conditions }}</span>
          </template>
          <template #cell-actions="{ row }">
            <span class="automation-library__ellipsis">{{ row.actions.join(', ') || '—' }}</span>
          </template>
          <template #empty>
            <BaseEmptyState
              v-if="eventQuery.trim()"
              :title="t('automations.library.noMatches', { query: eventQuery.trim() })"
            />
            <BaseEmptyState
              v-else
              :title="t('automations.library.emptyEvents')"
              :description="t('automations.library.emptyEventsHint')"
            >
              <template #icon>
                <IconFlow :size="28" />
              </template>
            </BaseEmptyState>
          </template>
        </BaseTable>
        <BaseTable
          v-else
          v-model:selected="selected"
          class="automation-library__table"
          :columns="actionColumns"
          :rows="actionRows"
          :row-key="(row) => row.id"
          selectable
        >
          <template #cell-enabled="{ row }">
            <BaseCheckbox
              :model-value="row.enabled"
              :aria-label="t('automations.library.enable', { name: row.name })"
              @update:model-value="emit('setEnabled', 'actions', row.id, $event)"
            />
          </template>
          <template #cell-name="{ row }">
            <span class="automation-library__name">{{ row.name }}</span>
            <span class="automation-library__sub">{{ row.detail }}</span>
          </template>
          <template #cell-type="{ row }">
            <span class="automation-library__ellipsis">{{ row.type }}</span>
            <span
              v-if="row.missing"
              class="automation-library__warning"
            >{{ t('automations.library.pluginMissing') }}</span>
          </template>
          <template #cell-lastRun="{ row }">
            <span :class="{ 'automation-library__failed': row.failed }">{{ row.lastRun }}</span>
          </template>
          <template #empty>
            <BaseEmptyState
              v-if="actionQuery.trim()"
              :title="t('automations.library.noMatches', { query: actionQuery.trim() })"
            />
            <BaseEmptyState
              v-else
              :title="t('automations.library.emptyActions')"
              :description="t('automations.library.emptyActionsHint')"
            >
              <template #icon>
                <IconFlow :size="28" />
              </template>
            </BaseEmptyState>
          </template>
        </BaseTable>
      </div>
    </BaseTabs>
  </section>
</template>

<style scoped>
.automation-library {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border: var(--border-width) solid var(--color-border-subtle);
  background: var(--color-bg-panel);
}

.automation-library__tabs {
  height: 100%;
}

.automation-library__pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.automation-library__toolbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: var(--border-width) solid var(--color-border-subtle);
}

.automation-library__search {
  flex: 1;
  min-width: 0;
}

.automation-library__sort {
  width: 150px;
}

.automation-library__table {
  flex: 1;
  min-height: 0;
}

.automation-library__name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.automation-library__sub,
.automation-library__warning {
  display: block;
  overflow: hidden;
  color: var(--color-text-subtle);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.automation-library__warning {
  color: var(--color-warning);
}

.automation-library__ellipsis {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.automation-library__failed {
  color: var(--color-danger-hover);
}
</style>
