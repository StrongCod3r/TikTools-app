<script setup lang="ts">
defineProps<{
  label: string;
  for: string;
  hint?: string;
}>();
</script>

<template>
  <label
    class="base-form-row__label"
    :for="$props.for"
  >{{ label }}</label>
  <div class="base-form-row__control">
    <slot />
    <p
      v-if="hint"
      class="base-form-row__hint"
    >
      {{ hint }}
    </p>
  </div>
</template>

<style scoped>
.base-form-row__label {
  justify-self: end;
  color: var(--color-text);
  text-align: right;
}

.base-form-row__control {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.base-form-row__hint {
  margin: 0;
  color: var(--color-text-subtle);
  font-size: var(--font-size-sm);
}
</style>
