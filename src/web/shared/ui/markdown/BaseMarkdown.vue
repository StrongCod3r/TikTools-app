<script setup lang="ts">
import { computed } from 'vue';
import { parseMarkdownLite, type MarkdownSpan as Span } from '@/shared/lib/markdown-lite.ts';
import MarkdownSpan from './MarkdownSpan.vue';

const props = withDefaults(
  defineProps<{
    source: string;
    inline?: boolean;
  }>(),
  { inline: false },
);

const blocks = computed(() => parseMarkdownLite(props.source));
const inlineSpans = computed<Array<Span | { separator: string }>>(() =>
  blocks.value.flatMap((block, blockIndex) => {
    const parts: Array<Span | { separator: string }> = blockIndex > 0 ? [{ separator: ' ' }] : [];
    if (block.kind === 'paragraph') return [...parts, ...block.spans];
    return [
      ...parts,
      ...block.items.flatMap((item, itemIndex) => (itemIndex > 0 ? [{ separator: ' · ' }, ...item] : item)),
    ];
  }),
);
</script>

<template>
  <span
    v-if="inline"
    class="base-markdown base-markdown--inline"
  >
    <template
      v-for="(span, index) in inlineSpans"
      :key="index"
    >
      <template v-if="'separator' in span">{{ span.separator }}</template>
      <MarkdownSpan
        v-else
        :span="span"
      />
    </template>
  </span>
  <div
    v-else
    class="base-markdown"
  >
    <template
      v-for="(block, blockIndex) in blocks"
      :key="blockIndex"
    >
      <p v-if="block.kind === 'paragraph'">
        <template
          v-for="(span, index) in block.spans"
          :key="index"
        >
          <MarkdownSpan :span="span" />
        </template>
      </p>
      <ul v-else>
        <li
          v-for="(item, itemIndex) in block.items"
          :key="itemIndex"
        >
          <template
            v-for="(span, index) in item"
            :key="index"
          >
            <MarkdownSpan :span="span" />
          </template>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.base-markdown {
  color: var(--color-text);
  line-height: var(--line-height-normal);
}

.base-markdown p,
.base-markdown ul {
  margin: 0 0 var(--space-4);
}

.base-markdown ul {
  padding-left: var(--space-6);
}

</style>
