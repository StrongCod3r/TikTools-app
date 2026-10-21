<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePointsStore } from '@/entities/points/model/points-store.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BaseDialog from '@/shared/ui/dialog/BaseDialog.vue';
import BaseFormGrid from '@/shared/ui/form/BaseFormGrid.vue';
import BaseFormRow from '@/shared/ui/form/BaseFormRow.vue';
import BaseSegmented from '@/shared/ui/segmented/BaseSegmented.vue';
import BaseSpinBox from '@/shared/ui/spin-box/BaseSpinBox.vue';
import type { AdjustMode } from '../model/adjust-mode.ts';

const props = defineProps<{
  viewer: string | null;
  initialMode: AdjustMode;
}>();

const open = defineModel<boolean>('open', { default: false });
const { t } = useI18n();
const store = usePointsStore();
const mode = ref<AdjustMode>(props.initialMode);
const amount = ref(50);
const busy = ref(false);

const modes = computed(() => [
  { value: 'add' as const, label: t('points.adjust.add') },
  { value: 'deduct' as const, label: t('points.adjust.deduct') },
]);

watch(open, (isOpen) => {
  if (!isOpen) return;
  mode.value = props.initialMode;
  amount.value = 50;
});

async function apply(): Promise<void> {
  if (!props.viewer || amount.value <= 0 || busy.value) return;
  busy.value = true;
  try {
    await store.adjust(props.viewer, mode.value === 'deduct' ? -amount.value : amount.value);
    open.value = false;
  } catch {
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BaseDialog
    v-model:open="open"
    :title="t('points.adjust.title', { viewer: `@${viewer ?? ''}` })"
    :width="400"
  >
    <form @submit.prevent="apply">
      <BaseFormGrid>
        <BaseFormRow
          for="adjust-mode"
          :label="t('points.adjust.operation')"
        >
          <BaseSegmented
            id="adjust-mode"
            v-model="mode"
            :options="modes"
          />
        </BaseFormRow>
        <BaseFormRow
          for="adjust-amount"
          :label="t('points.adjust.amount')"
        >
          <BaseSpinBox
            id="adjust-amount"
            v-model="amount"
            :min="1"
            :step="10"
          />
        </BaseFormRow>
      </BaseFormGrid>
    </form>
    <template #footer>
      <BaseButton
        :variant="mode === 'deduct' ? 'danger' : 'primary'"
        :disabled="busy || amount <= 0"
        @click="apply"
      >
        {{ mode === 'deduct' ? t('points.adjust.confirmDeduct') : t('points.adjust.confirmAdd') }}
      </BaseButton>
      <BaseButton @click="open = false">
        {{ t('common.cancel') }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>
