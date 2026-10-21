<template>
  <div class="base-form-grid">
    <slot />
  </div>
</template>

<style scoped>
.base-form-grid {
  display: grid;
  grid-template-columns: minmax(120px, max-content) minmax(0, 1fr);
  gap: var(--space-4) var(--space-5);
  align-items: center;
}
</style>
