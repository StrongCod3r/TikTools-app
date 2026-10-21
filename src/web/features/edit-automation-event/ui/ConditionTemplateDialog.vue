<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConditionTemplate } from '../../../../automation/behavior/condition-templates.ts';
import { localizedText } from '@/shared/i18n/i18n.ts';
import BaseButton from '@/shared/ui/button/BaseButton.vue';
import BaseDialog from '@/shared/ui/dialog/BaseDialog.vue';
import BaseFormGrid from '@/shared/ui/form/BaseFormGrid.vue';
import BaseFormRow from '@/shared/ui/form/BaseFormRow.vue';
import BaseTextField from '@/shared/ui/text-field/BaseTextField.vue';

const props = defineProps<{
  template: ConditionTemplate | null;
}>();

const emit = defineEmits<{ apply: [answers: Record<string, string>] }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const id = useId();
const answers = ref<Record<string, string>>({});

const params = computed(() => props.template?.params ?? []);
const title = computed(() => (props.template ? t('automations.conditions.configure', { title: localizedText(props.template.title) }) : ''));

watch(
  () => props.template,
  (template) => {
    answers.value = Object.fromEntries((template?.params ?? []).map((param) => [param.key, param.default]));
  },
  { immediate: true },
);

function apply(): void {
  const record: Record<string, string> = {};
  for (const param of params.value) {
    const value = (answers.value[param.key] ?? '').trim();
    record[param.key] = value === '' ? param.default : value;
  }
  emit('apply', record);
  open.value = false;
}
</script>

<template>
  <BaseDialog
    v-model:open="open"
    :title="title"
    :width="440"
  >
    <p class="condition-template__lead">
      {{ t('automations.conditions.configureLead') }}
    </p>
    <BaseFormGrid>
      <BaseFormRow
        v-for="param in params"
        :key="param.key"
        :for="`${id}-${param.key}`"
        :label="localizedText(param.label)"
        :hint="param.hint ? localizedText(param.hint) : undefined"
      >
        <BaseTextField
          :id="`${id}-${param.key}`"
          v-model="answers[param.key]"
          :inputmode="param.kind === 'number' ? 'decimal' : undefined"
          :placeholder="param.default"
        />
      </BaseFormRow>
    </BaseFormGrid>
    <template #footer>
      <BaseButton
        variant="primary"
        @click="apply"
      >
        {{ t('automations.conditions.apply') }}
      </BaseButton>
      <BaseButton @click="open = false">
        {{ t('common.cancel') }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>

<style scoped>
.condition-template__lead {
  margin: 0 0 var(--space-5);
  color: var(--color-text-muted);
}
</style>
