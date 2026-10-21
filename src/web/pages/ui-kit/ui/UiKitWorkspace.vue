<script setup lang="ts">
import { computed, markRaw, ref, useTemplateRef } from 'vue';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BaseIconButton from '@/shared/ui/button/BaseIconButton.vue';
import BaseCheckbox from '@/shared/ui/checkbox/BaseCheckbox.vue';
import BaseDialog from '@/shared/ui/dialog/BaseDialog.vue';
import IconChevronDown from '@/shared/ui/icon/icons/IconChevronDown.vue';
import IconChevronUp from '@/shared/ui/icon/icons/IconChevronUp.vue';
import IconEye from '@/shared/ui/icon/icons/IconEye.vue';
import IconEyeOff from '@/shared/ui/icon/icons/IconEyeOff.vue';
import IconGear from '@/shared/ui/icon/icons/IconGear.vue';
import IconLock from '@/shared/ui/icon/icons/IconLock.vue';
import IconPlus from '@/shared/ui/icon/icons/IconPlus.vue';
import IconTrash from '@/shared/ui/icon/icons/IconTrash.vue';
import IconUnlock from '@/shared/ui/icon/icons/IconUnlock.vue';
import BaseList from '@/shared/ui/list/BaseList.vue';
import BaseContextMenu from '@/shared/ui/menu/BaseContextMenu.vue';
import BaseMenu from '@/shared/ui/menu/BaseMenu.vue';
import type { MenuAction, MenuEntry } from '@/shared/ui/menu/menu-types.ts';
import BaseSplitter from '@/shared/ui/splitter/BaseSplitter.vue';
import BaseTable from '@/shared/ui/table/BaseTable.vue';
import type { TableSort } from '@/shared/ui/table/table-types.ts';
import BaseTabs from '@/shared/ui/tabs/BaseTabs.vue';
import BaseTextField from '@/shared/ui/text-field/BaseTextField.vue';
import BaseToolbar from '@/shared/ui/toolbar/BaseToolbar.vue';

interface Source {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

interface Viewer {
  id: string;
  name: string;
  gifts: number;
  points: number;
}

const sources = ref<Source[]>([
  { id: 'display', name: 'Display capture', visible: true, locked: false },
  { id: 'camera', name: 'Webcam', visible: true, locked: true },
  { id: 'alerts', name: 'Gift alerts', visible: false, locked: false },
  { id: 'chat', name: 'Chat overlay', visible: true, locked: false },
]);
const selectedSource = ref<string | null>('display');
const lastAction = ref('—');
const paneSize = ref(280);

const sourceMenu = computed<MenuEntry[]>(() => [
  {
    id: 'add',
    label: 'Add',
    icon: markRaw(IconPlus),
    children: [
      { id: 'add-image', label: 'Image' },
      { id: 'add-text', label: 'Text' },
      { id: 'add-browser', label: 'Browser' },
    ],
  },
  { type: 'separator', id: 'sep-1' },
  { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', disabled: !selectedSource.value },
  { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', disabled: true },
  { type: 'separator', id: 'sep-2' },
  { id: 'lock', label: 'Lock', checked: sources.value.find((source) => source.id === selectedSource.value)?.locked ?? false },
  { id: 'remove', label: 'Remove', icon: markRaw(IconTrash), shortcut: 'Del', disabled: !selectedSource.value },
  { type: 'separator', id: 'sep-3' },
  { id: 'properties', label: 'Properties', icon: markRaw(IconGear), disabled: !selectedSource.value },
]);

const fileMenu: MenuEntry[] = [
  { id: 'new', label: 'New profile', shortcut: 'Ctrl+N' },
  { id: 'import', label: 'Import' },
  { type: 'separator', id: 'sep' },
  {
    id: 'recent',
    label: 'Recent',
    children: [
      { id: 'recent-1', label: 'Weekend stream' },
      { id: 'recent-2', label: 'Gaming night' },
    ],
  },
  { id: 'exit', label: 'Exit' },
];

const menuTrigger = useTemplateRef('menuTrigger');
const fileMenuOpen = ref(false);
const dialogOpen = ref(false);
const dialogName = ref('Display capture');
const dialogCursor = ref(true);
const tab = ref('general');
const tabs = [
  { value: 'general', label: 'General' },
  { value: 'stream', label: 'Stream' },
  { value: 'output', label: 'Output' },
  { value: 'hotkeys', label: 'Hotkeys', disabled: true },
];

const viewers: Viewer[] = [
  { id: '1', name: 'luna.live', gifts: 42, points: 12840 },
  { id: '2', name: 'pixelpanda', gifts: 17, points: 6420 },
  { id: '3', name: 'zeta_streams', gifts: 9, points: 3100 },
  { id: '4', name: 'mango', gifts: 3, points: 980 },
];
const viewerColumns = [
  { key: 'name', label: 'Viewer', sortable: true },
  { key: 'gifts', label: 'Gifts', align: 'end' as const, sortable: true, width: '80px' },
  { key: 'points', label: 'Points', align: 'end' as const, sortable: true, width: '100px' },
];
const viewerSort = ref<TableSort | null>({ key: 'points', direction: 'desc' });
const selectedViewer = ref<string | null>(null);
const sortedViewers = computed(() => {
  const sort = viewerSort.value;
  if (!sort) return viewers;
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...viewers].sort((left, right) => {
    const a = left[sort.key as keyof Viewer];
    const b = right[sort.key as keyof Viewer];
    return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) * factor;
  });
});

function onAction(action: MenuAction): void {
  lastAction.value = action.label;
  const source = sources.value.find((item) => item.id === selectedSource.value);
  if (action.id === 'lock' && source) source.locked = !source.locked;
  if (action.id === 'remove') {
    sources.value = sources.value.filter((item) => item.id !== selectedSource.value);
    selectedSource.value = null;
  }
  if (action.id === 'properties') dialogOpen.value = true;
}

function move(direction: -1 | 1): void {
  const index = sources.value.findIndex((item) => item.id === selectedSource.value);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= sources.value.length) return;
  const next = [...sources.value];
  [next[index], next[target]] = [next[target]!, next[index]!];
  sources.value = next;
}
</script>

<template>
  <section class="workspace">
    <header class="workspace__menubar">
      <button
        ref="menuTrigger"
        class="workspace__menu-trigger"
        type="button"
        aria-haspopup="menu"
        :aria-expanded="fileMenuOpen"
        @click="fileMenuOpen = !fileMenuOpen"
      >
        File
      </button>
      <BaseMenu
        v-model:open="fileMenuOpen"
        :items="fileMenu"
        :anchor="menuTrigger"
        @select="onAction"
      />
      <span class="workspace__status">Last action: {{ lastAction }}</span>
    </header>
    <BaseSplitter
      v-model:size="paneSize"
      class="workspace__split"
      :min="200"
      :max="480"
    >
      <template #start>
        <div class="workspace__dock">
          <header class="workspace__dock-title">
            Sources
          </header>
          <BaseContextMenu
            :items="sourceMenu"
            @select="onAction"
          >
            <BaseList
              v-model:selected="selectedSource"
              class="workspace__list"
              :items="sources"
              :item-key="(source) => source.id"
              aria-label="Sources"
              @activate="dialogOpen = true"
            >
              <template #default="{ item }">
                <span class="workspace__source-name">{{ item.name }}</span>
                <BaseIconButton
                  :label="item.visible ? 'Hide' : 'Show'"
                  size="sm"
                  tabindex="-1"
                  @click="item.visible = !item.visible"
                >
                  <IconEye v-if="item.visible" />
                  <IconEyeOff v-else />
                </BaseIconButton>
                <BaseIconButton
                  :label="item.locked ? 'Unlock' : 'Lock'"
                  size="sm"
                  tabindex="-1"
                  @click="item.locked = !item.locked"
                >
                  <IconLock v-if="item.locked" />
                  <IconUnlock v-else />
                </BaseIconButton>
              </template>
              <template #empty>
                No sources. Right click to add one.
              </template>
            </BaseList>
          </BaseContextMenu>
          <BaseToolbar
            class="workspace__dock-toolbar"
            aria-label="Source actions"
          >
            <BaseIconButton label="Add source">
              <IconPlus />
            </BaseIconButton>
            <BaseIconButton
              label="Remove source"
              :disabled="!selectedSource"
              @click="onAction({ id: 'remove', label: 'Remove' })"
            >
              <IconTrash />
            </BaseIconButton>
            <BaseIconButton
              label="Source properties"
              :disabled="!selectedSource"
              @click="dialogOpen = true"
            >
              <IconGear />
            </BaseIconButton>
            <BaseIconButton
              label="Move up"
              :disabled="!selectedSource"
              @click="move(-1)"
            >
              <IconChevronUp />
            </BaseIconButton>
            <BaseIconButton
              label="Move down"
              :disabled="!selectedSource"
              @click="move(1)"
            >
              <IconChevronDown />
            </BaseIconButton>
          </BaseToolbar>
        </div>
      </template>
      <template #end>
        <div class="workspace__dock">
          <BaseTabs
            v-model="tab"
            class="workspace__tabs"
            :tabs="tabs"
          >
            <template #default="{ value }">
              <BaseTable
                v-if="value === 'general'"
                v-model:sort="viewerSort"
                v-model:selected="selectedViewer"
                class="workspace__table"
                :columns="viewerColumns"
                :rows="sortedViewers"
                :row-key="(viewer) => viewer.id"
                selectable
              >
                <template #cell-points="{ value: points }">
                  {{ Number(points).toLocaleString() }}
                </template>
              </BaseTable>
              <p
                v-else
                class="workspace__placeholder"
              >
                {{ value }} settings
              </p>
            </template>
          </BaseTabs>
        </div>
      </template>
    </BaseSplitter>
    <BaseDialog
      v-model:open="dialogOpen"
      title="Properties for 'Display capture'"
      :width="520"
    >
      <div class="workspace__form">
        <label
          class="workspace__label"
          for="dialog-name"
        >Name</label>
        <BaseTextField
          id="dialog-name"
          v-model="dialogName"
        />
        <span />
        <BaseCheckbox v-model="dialogCursor">
          Capture cursor
        </BaseCheckbox>
      </div>
      <template #footer-start>
        <BaseButton>Defaults</BaseButton>
      </template>
      <template #footer>
        <BaseButton
          variant="primary"
          @click="dialogOpen = false"
        >
          OK
        </BaseButton>
        <BaseButton @click="dialogOpen = false">
          Cancel
        </BaseButton>
      </template>
    </BaseDialog>
  </section>
</template>

<style scoped>
.workspace {
  display: flex;
  flex-direction: column;
  height: 420px;
  border: var(--border-width) solid var(--color-border-subtle);
  background: var(--color-bg-app);
}

.workspace__menubar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: var(--control-height-md);
  padding: 0 var(--space-2);
  background: var(--color-bg-panel);
}

.workspace__menu-trigger {
  height: 100%;
  padding: 0 var(--space-4);
  border: 0;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  cursor: default;
  transform: none;
}

.workspace__menu-trigger:hover,
.workspace__menu-trigger[aria-expanded='true'] {
  background: var(--color-bg-hover);
}

.workspace__status {
  margin-left: auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.workspace__split {
  flex: 1;
  padding: var(--space-2);
}

.workspace__dock {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  border: var(--border-width) solid var(--color-border-subtle);
  background: var(--color-bg-panel);
}

.workspace__dock-title {
  padding: var(--space-3) var(--space-4);
  background: var(--color-bg-panel-header);
  font-weight: var(--font-weight-semibold);
}

.workspace__list {
  flex: 1;
}

.workspace__source-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace__dock-toolbar {
  padding: var(--space-2);
  border-top: var(--border-width) solid var(--color-border-subtle);
}

.workspace__tabs {
  flex: 1;
  padding: var(--space-2) var(--space-2) 0;
}

.workspace__table {
  height: 100%;
}

.workspace__placeholder {
  padding: var(--space-5);
  color: var(--color-text-subtle);
  text-transform: capitalize;
}

.workspace__form {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-4) var(--space-5);
  align-items: center;
}

.workspace__label {
  justify-self: end;
}
</style>
