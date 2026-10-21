<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { analyticsRangeKeys, type AnalyticsRangeKey } from '@/entities/analytics/lib/analytics-range.ts';
import BaseDateField from '@/shared/ui/date-field/BaseDateField.vue';
import BaseSegmented from '@/shared/ui/segmented/BaseSegmented.vue';

const range = defineModel<AnalyticsRangeKey>('range', { required: true });
const start = defineModel<string>('start', { required: true });
const end = defineModel<string>('end', { required: true });

const { t } = useI18n();
const options = computed(() => analyticsRangeKeys.map((key) => ({ value: key, label: t(`analytics.ranges.${key}`) })));
</script>

<template>
  <div class="range-bar">
    <BaseSegmented
      v-model="range"
      :options="options"
      :aria-label="t('analytics.rangeLabel')"
    />
    <div
      v-if="range === 'custom'"
      class="range-bar__custom"
    >
      <label class="range-bar__field">
        <span>{{ t('analytics.ranges.from') }}</span>
        <BaseDateField
          v-model="start"
          :max="end"
        />
      </label>
      <label class="range-bar__field">
        <span>{{ t('analytics.ranges.to') }}</span>
        <BaseDateField
          v-model="end"
          :min="start"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.range-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-5);
}

.range-bar__custom {
  display: flex;
  gap: var(--space-5);
}

.range-bar__field {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text-muted);
}
</style>
