<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, markRaw, ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePointsStore } from '@/entities/points/model/points-store.ts';
import LeaderboardTable from '@/entities/points/ui/LeaderboardTable.vue';
import type { AdjustMode } from '@/features/adjust-viewer-points/model/adjust-mode.ts';
import AdjustPointsDialog from '@/features/adjust-viewer-points/ui/AdjustPointsDialog.vue';
import ResetPointsDialog from '@/features/reset-points/ui/ResetPointsDialog.vue';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BaseIconButton from '@/shared/ui/button/BaseIconButton.vue';
import IconMinus from '@/shared/ui/icon/icons/IconMinus.vue';
import IconMoreVertical from '@/shared/ui/icon/icons/IconMoreVertical.vue';
import IconPlus from '@/shared/ui/icon/icons/IconPlus.vue';
import IconRefresh from '@/shared/ui/icon/icons/IconRefresh.vue';
import IconSearch from '@/shared/ui/icon/icons/IconSearch.vue';
import IconTrash from '@/shared/ui/icon/icons/IconTrash.vue';
import BaseContextMenu from '@/shared/ui/menu/BaseContextMenu.vue';
import BaseMenu from '@/shared/ui/menu/BaseMenu.vue';
import type { MenuAction, MenuEntry } from '@/shared/ui/menu/menu-types.ts';
import BasePanel from '@/shared/ui/panel/BasePanel.vue';
import type { TableSort } from '@/shared/ui/table/table-types.ts';
import BaseTextField from '@/shared/ui/text-field/BaseTextField.vue';

const props = defineProps<{
  locked: boolean;
}>();

const query = defineModel<string>('query', { default: '' });
const sort = defineModel<TableSort | null>('sort', { default: null });

const { t } = useI18n();
const store = usePointsStore();
const { leaderboard, pointsConfig, error } = storeToRefs(store);
const table = ref<InstanceType<typeof LeaderboardTable> | null>(null);
const selected = ref<string | null>(null);
const menuOpen = ref(false);
const menuAnchor = shallowRef<HTMLElement | null>(null);
const adjustOpen = ref(false);
const adjustMode = ref<AdjustMode>('add');
const resetOpen = ref(false);
const resetTarget = ref<string | null>(null);

const visibleCount = computed(() => table.value?.count ?? leaderboard.value.length);

const viewerMenu = computed<MenuEntry[]>(() => [
  { id: 'add', label: t('points.actions.add'), icon: markRaw(IconPlus) },
  { id: 'deduct', label: t('points.actions.deduct'), icon: markRaw(IconMinus) },
  { type: 'separator', id: 'separator' },
  { id: 'reset', label: t('points.actions.reset'), icon: markRaw(IconTrash), disabled: props.locked },
]);

function openRowMenu(viewer: string, event: MouseEvent): void {
  selected.value = viewer;
  menuAnchor.value = event.currentTarget as HTMLElement;
  menuOpen.value = true;
}

function onAction(action: MenuAction): void {
  const viewer = selected.value;
  if (!viewer) return;
  if (action.id === 'add' || action.id === 'deduct') {
    adjustMode.value = action.id;
    adjustOpen.value = true;
  } else if (action.id === 'reset') {
    resetTarget.value = viewer;
    resetOpen.value = true;
  }
}

function resetAll(): void {
  resetTarget.value = null;
  resetOpen.value = true;
}
</script>

<template>
  <BasePanel
    class="points-leaderboard"
    :title="t('points.leaderboard.title')"
    :subtitle="t('points.leaderboard.count', { count: visibleCount })"
    flush
  >
    <template #actions>
      <BaseTextField
        v-model="query"
        class="points-leaderboard__search"
        type="search"
        size="sm"
        :placeholder="t('points.leaderboard.search')"
        :aria-label="t('points.leaderboard.search')"
      >
        <template #prefix>
          <IconSearch />
        </template>
      </BaseTextField>
      <BaseIconButton
        :label="t('points.leaderboard.refresh')"
        size="sm"
        @click="store.refresh()"
      >
        <IconRefresh />
      </BaseIconButton>
    </template>
    <p
      v-if="error"
      class="points-leaderboard__error"
      role="alert"
    >
      {{ error }}
    </p>
    <BaseContextMenu
      :items="viewerMenu"
      :disabled="!selected"
      @select="onAction"
    >
      <LeaderboardTable
        ref="table"
        v-model:sort="sort"
        v-model:selected="selected"
        class="points-leaderboard__table"
        :viewers="leaderboard"
        :query="query"
        :currency="pointsConfig.currencyName"
      >
        <template #actions="{ viewer }">
          <BaseIconButton
            :label="t('points.actions.menu', { viewer: `@${viewer.uniqueId}` })"
            size="sm"
            @click="openRowMenu(viewer.uniqueId, $event)"
          >
            <IconMoreVertical />
          </BaseIconButton>
        </template>
      </LeaderboardTable>
    </BaseContextMenu>
    <BaseMenu
      v-model:open="menuOpen"
      :items="viewerMenu"
      :anchor="menuAnchor"
      placement="bottom-end"
      @select="onAction"
    />
    <template #footer>
      <BaseButton
        variant="danger"
        size="sm"
        :disabled="locked || !leaderboard.length"
        @click="resetAll"
      >
        <template #icon>
          <IconTrash />
        </template>
        {{ t('points.actions.resetAll') }}
      </BaseButton>
    </template>
    <AdjustPointsDialog
      v-model:open="adjustOpen"
      :viewer="selected"
      :initial-mode="adjustMode"
    />
    <ResetPointsDialog
      v-model:open="resetOpen"
      :viewer="resetTarget"
    />
  </BasePanel>
</template>

<style scoped>
.points-leaderboard__search {
  width: 220px;
}

.points-leaderboard__error {
  margin: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--color-danger);
  border-radius: var(--radius-sm);
  color: var(--color-danger-hover);
}

.points-leaderboard__table {
  height: 100%;
}
</style>
