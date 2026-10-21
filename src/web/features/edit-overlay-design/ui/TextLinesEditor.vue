<script setup lang="ts">
import { computed, markRaw, nextTick, ref, shallowRef, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { WidgetTemplateToken } from '../../../../widgets/sdk/template.ts';
import type { TextField } from '../../../../widgets/sdk/text.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BaseIconButton from '@/shared/ui/button/BaseIconButton.vue';
import IconChevronDown from '@/shared/ui/icon/icons/IconChevronDown.vue';
import IconChevronUp from '@/shared/ui/icon/icons/IconChevronUp.vue';
import IconClose from '@/shared/ui/icon/icons/IconClose.vue';
import IconPlus from '@/shared/ui/icon/icons/IconPlus.vue';
import BaseMenu from '@/shared/ui/menu/BaseMenu.vue';
import type { MenuAction, MenuEntry } from '@/shared/ui/menu/menu-types.ts';
import BaseTextField from '@/shared/ui/text-field/BaseTextField.vue';
import { TEXT_MAX_LENGTH, type DesignEditor, type Placement } from '../model/use-design-editor.ts';

const props = withDefaults(
  defineProps<{
    editor: DesignEditor;
    showLines?: boolean;
    showAdd?: boolean;
  }>(),
  { showLines: true, showAdd: true },
);

const { t } = useI18n();
const baseId = useId();
const rows = new Map<TextField, HTMLElement>();
const tokenField = ref<TextField | null>(null);
const tokenOpen = ref(false);
const tokenAnchor = shallowRef<HTMLElement | null>(null);
const addOpen = ref(false);
const addAnchor = shallowRef<HTMLElement | null>(null);

const tokens = computed(() => props.editor.schema.value.tokens);
const tokenMenu = computed<MenuEntry[]>(() =>
  tokens.value.map((token) => ({ id: token, label: `${t(`overlays.editor.tokens.${token}`)}  {{${token}}}` })),
);
const addMenu = computed<MenuEntry[]>(() =>
  props.editor.hiddenFields.value.map((field) => ({
    id: field,
    label: t(`overlays.editor.fields.${field}`),
    children: [
      { id: `${field}:top`, label: t('overlays.editor.addAtTop') },
      { id: `${field}:bottom`, label: t('overlays.editor.addAtBottom') },
    ],
  })),
);

function inputFor(field: TextField): HTMLInputElement | null {
  return rows.get(field)?.querySelector('input') ?? null;
}

function setRow(field: TextField, element: unknown): void {
  if (element instanceof HTMLElement) rows.set(field, element);
  else rows.delete(field);
}

function openTokens(field: TextField, event: MouseEvent): void {
  tokenField.value = field;
  tokenAnchor.value = markRaw(event.currentTarget as HTMLElement);
  tokenOpen.value = true;
}

function insert(action: MenuAction): void {
  const field = tokenField.value;
  if (!field) return;
  const input = inputFor(field);
  const current = props.editor.textOf(field);
  const start = input?.selectionStart ?? current.length;
  const end = input?.selectionEnd ?? start;
  const caret = props.editor.insertToken(field, action.id as WidgetTemplateToken, start, end);
  void nextTick(() => {
    const target = inputFor(field);
    target?.focus();
    target?.setSelectionRange(caret, caret);
  });
}

function openAdd(event: MouseEvent): void {
  addAnchor.value = markRaw(event.currentTarget as HTMLElement);
  addOpen.value = true;
}

function add(action: MenuAction): void {
  const [field, placement] = action.id.split(':') as [TextField, Placement | undefined];
  if (placement) props.editor.addField(field, placement);
}
</script>

<template>
  <div class="text-lines">
    <template v-if="showLines">
      <div
        v-for="(field, index) in editor.orderedVisible.value"
        :key="field"
        :ref="(element) => setRow(field, element)"
        class="text-lines__row"
      >
        <label
          class="text-lines__label"
          :for="`${baseId}-${field}`"
        >{{ t(`overlays.editor.fields.${field}`) }}</label>
        <div class="text-lines__control">
          <BaseTextField
            :id="`${baseId}-${field}`"
            :model-value="editor.textOf(field)"
            :maxlength="TEXT_MAX_LENGTH"
            spellcheck="false"
            @update:model-value="editor.setText(field, $event)"
          />
          <BaseIconButton
            :label="t('overlays.editor.insertToken')"
            size="sm"
            aria-haspopup="menu"
            @click="openTokens(field, $event)"
          >
            <IconPlus />
          </BaseIconButton>
          <BaseIconButton
            :label="t('overlays.editor.moveUp')"
            size="sm"
            :disabled="index === 0"
            @click="editor.moveField(field, -1)"
          >
            <IconChevronUp />
          </BaseIconButton>
          <BaseIconButton
            :label="t('overlays.editor.moveDown')"
            size="sm"
            :disabled="index === editor.orderedVisible.value.length - 1"
            @click="editor.moveField(field, 1)"
          >
            <IconChevronDown />
          </BaseIconButton>
          <BaseIconButton
            v-if="editor.removableFields.value.has(field)"
            :label="t('overlays.editor.removeField')"
            size="sm"
            @click="editor.removeField(field)"
          >
            <IconClose />
          </BaseIconButton>
        </div>
      </div>
    </template>
    <BaseButton
      v-if="showAdd && editor.hiddenFields.value.length"
      class="text-lines__add"
      size="sm"
      aria-haspopup="menu"
      @click="openAdd"
    >
      <template #icon>
        <IconPlus />
      </template>
      {{ t('overlays.editor.addField') }}
    </BaseButton>
    <BaseMenu
      v-model:open="tokenOpen"
      :items="tokenMenu"
      :anchor="tokenAnchor"
      placement="bottom-end"
      @select="insert"
    />
    <BaseMenu
      v-model:open="addOpen"
      :items="addMenu"
      :anchor="addAnchor"
      @select="add"
    />
  </div>
</template>

<style scoped>
.text-lines {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.text-lines__row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.text-lines__label {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.text-lines__control {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.text-lines__control > :first-child {
  flex: 1;
  min-width: 0;
}

.text-lines__add {
  align-self: flex-start;
}
</style>
