<script setup lang="ts">
import { useId } from 'vue';
import IconChevronDown from '@/shared/ui/icon/icons/IconChevronDown.vue';
import IconChevronRight from '@/shared/ui/icon/icons/IconChevronRight.vue';

defineProps<{
  title: string;
  count?: number;
}>();

const open = defineModel<boolean>('open', { default: false });
const id = useId();
</script>

<template>
  <section class="base-disclosure">
    <button
      class="base-disclosure__toggle"
      type="button"
      :aria-expanded="open"
      :aria-controls="id"
      @click="open = !open"
    >
      <IconChevronDown v-if="open" />
      <IconChevronRight v-else />
      <span>{{ title }}</span>
      <span
        v-if="count !== undefined"
        class="base-disclosure__count"
      >{{ count }}</span>
    </button>
    <div
      v-show="open"
      :id="id"
      class="base-disclosure__body"
    >
      <slot />
    </div>
  </section>
</template>

<style scoped>
.base-disclosure {
  border-top: var(--border-width) solid var(--color-border-subtle);
}

.base-disclosure__toggle {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-3);
  width: 100%;
  height: var(--control-height-md);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-family);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  text-align: left;
  cursor: pointer;
  outline: none;
  transform: none;
}

.base-disclosure__toggle:hover {
  color: var(--color-text);
}

.base-disclosure__toggle:focus-visible {
  box-shadow: var(--focus-ring);
}

.base-disclosure__count {
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-bg-control);
  font-size: var(--font-size-xs);
}

.base-disclosure__body {
  padding: var(--space-3) 0 var(--space-2);
}
</style>
