<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { supportedLocales, type Locale } from '@/shared/i18n/i18n.ts';
import BaseComboBox from '@/shared/ui/combo-box/BaseComboBox.vue';

const model = defineModel<Locale>({ required: true });
const { t } = useI18n();

const options = computed(() => supportedLocales.map((locale) => ({ value: locale, label: t(`menu.languages.${locale}`) })));
</script>

<template>
  <BaseComboBox
    v-model="model"
    :options="options"
  />
</template>
