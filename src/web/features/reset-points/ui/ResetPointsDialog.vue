<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePointsStore } from '@/entities/points/model/points-store.ts';
import BaseConfirmDialog from '@/shared/ui/dialog/BaseConfirmDialog.vue';

const props = defineProps<{
  viewer: string | null;
}>();

const open = defineModel<boolean>('open', { default: false });
const { t } = useI18n();
const store = usePointsStore();
const busy = ref(false);

const message = computed(() =>
  props.viewer ? t('points.reset.viewerMessage', { viewer: `@${props.viewer}` }) : t('points.reset.allMessage'),
);

async function confirm(): Promise<void> {
  busy.value = true;
  try {
    await store.reset(props.viewer ?? undefined);
    open.value = false;
  } catch {
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BaseConfirmDialog
    v-model:open="open"
    :title="viewer ? t('points.reset.viewerTitle') : t('points.reset.allTitle')"
    :message="message"
    :confirm-label="t('points.reset.confirm')"
    :busy="busy"
    danger
    @confirm="confirm"
  />
</template>
