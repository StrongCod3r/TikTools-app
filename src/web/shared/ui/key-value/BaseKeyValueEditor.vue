<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BaseIconButton from '@/shared/ui/button/BaseIconButton.vue';
import IconPlus from '@/shared/ui/icon/icons/IconPlus.vue';
import IconTrash from '@/shared/ui/icon/icons/IconTrash.vue';
import BaseTextField from '@/shared/ui/text-field/BaseTextField.vue';

interface Row {
  id: number;
  key: string;
  value: string;
}

const props = defineProps<{
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  disabled?: boolean;
}>();

const model = defineModel<Record<string, string>>({ default: () => ({}) });
const { t } = useI18n();
let nextId = 0;

function toRows(entries: Record<string, string>): Row[] {
  return Object.entries(entries).map(([key, value]) => ({ id: ++nextId, key, value }));
}

const rows = ref<Row[]>(toRows(model.value));

watch(model, (entries) => {
  const current = Object.fromEntries(rows.value.filter((row) => row.key).map((row) => [row.key, row.value]));
  if (JSON.stringify(current) !== JSON.stringify(entries)) rows.value = toRows(entries);
});

function emitRows(): void {
  model.value = Object.fromEntries(rows.value.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]));
}

function update(id: number, patch: Partial<Pick<Row, 'key' | 'value'>>): void {
  rows.value = rows.value.map((row) => (row.id === id ? { ...row, ...patch } : row));
  emitRows();
}

function add(): void {
  rows.value = [...rows.value, { id: ++nextId, key: '', value: '' }];
}

function remove(id: number): void {
  rows.value = rows.value.filter((row) => row.id !== id);
  emitRows();
}
</script>

<template>
  <div class="base-key-value">
    <div
      v-for="row in rows"
      :key="row.id"
      class="base-key-value__row"
    >
      <BaseTextField
        :model-value="row.key"
        :placeholder="props.keyPlaceholder ?? t('common.key')"
        :aria-label="t('common.key')"
        :disabled="disabled"
        @update:model-value="(key) => update(row.id, { key })"
      />
      <BaseTextField
        :model-value="row.value"
        :placeholder="props.valuePlaceholder ?? t('common.value')"
        :aria-label="t('common.value')"
        :disabled="disabled"
        @update:model-value="(value) => update(row.id, { value })"
      />
      <BaseIconButton
        :label="t('common.remove')"
        :disabled="disabled"
        @click="remove(row.id)"
      >
        <IconTrash />
      </BaseIconButton>
    </div>
    <BaseButton
      size="sm"
      :disabled="disabled"
      @click="add"
    >
      <template #icon>
        <IconPlus />
      </template>
      {{ t('common.add') }}
    </BaseButton>
  </div>
</template>

<style scoped>
.base-key-value {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

.base-key-value__row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) var(--control-height-md);
  gap: var(--space-2);
  width: 100%;
}
</style>
