<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <div
    class="base-empty-state"
    role="status"
  >
    <span
      v-if="$slots.icon"
      class="base-empty-state__icon"
    ><slot name="icon" /></span>
    <p class="base-empty-state__title">
      {{ title }}
    </p>
    <p
      v-if="description"
      class="base-empty-state__description"
    >
      {{ description }}
    </p>
    <slot />
  </div>
</template>

<style scoped>
.base-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-height: 160px;
  padding: var(--space-7);
  color: var(--color-text-muted);
  font-family: var(--font-family);
  text-align: center;
}

.base-empty-state__icon {
  color: var(--color-text-subtle);
}

.base-empty-state__title {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
}

.base-empty-state__description {
  max-width: 420px;
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: var(--line-height-normal);
}
</style>
