<script setup lang="ts">
import type { MarkdownSpan as Span } from '@/shared/lib/markdown-lite.ts';

defineProps<{
  span: Span;
}>();
</script>

<template>
  <a
    v-if="span.href"
    class="markdown-span__link"
    :href="span.href"
    target="_blank"
    rel="noopener noreferrer"
  ><MarkdownSpan :span="{ ...span, href: undefined }" /></a>
  <em v-else-if="span.italic"><MarkdownSpan :span="{ ...span, italic: false }" /></em>
  <strong v-else-if="span.bold"><MarkdownSpan :span="{ ...span, bold: false }" /></strong>
  <code
    v-else-if="span.code"
    class="markdown-span__code"
  >{{ span.text }}</code>
  <template v-else>
    {{ span.text }}
  </template>
</template>

<style scoped>
.markdown-span__link {
  color: var(--color-border-focus);
}

.markdown-span__code {
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--color-bg-control);
  font-family: var(--font-family-mono);
  font-size: 0.92em;
}
</style>
