<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <fieldset class="base-group-box">
    <legend class="base-group-box__title">
      {{ title }}
    </legend>
    <p
      v-if="description"
      class="base-group-box__description"
    >
      {{ description }}
    </p>
    <slot />
  </fieldset>
</template>

<style scoped>
.base-group-box {
  min-width: 0;
  margin: 0;
  padding: var(--space-4) var(--space-5) var(--space-5);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-panel);
  color: var(--color-text);
  font-family: var(--font-family);
  font-size: var(--font-size-md);
}

.base-group-box__title {
  padding: 0 var(--space-2);
  color: var(--color-text);
  font-weight: var(--font-weight-semibold);
}

.base-group-box__description {
  margin: 0 0 var(--space-5);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-normal);
}
</style>
