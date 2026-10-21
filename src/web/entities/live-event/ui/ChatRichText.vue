<script setup lang="ts">
import { computed } from 'vue';
import { resolveChatSegments } from '../../../../shared/emotes/resolve.ts';
import type { LiveEmote } from '../../../../shared/emotes/types.ts';
import { hasEmoteImageFailed, markEmoteImageFailed } from '../lib/emote-failures.ts';

const props = withDefaults(
  defineProps<{
    text: string;
    emotes?: LiveEmote[];
    images?: boolean;
  }>(),
  { emotes: undefined, images: true },
);

const segments = computed(() => resolveChatSegments(props.text, props.emotes));

function showImage(url: string | undefined): url is string {
  return Boolean(props.images && url && !hasEmoteImageFailed(url));
}
</script>

<template>
  <template
    v-for="(segment, index) in segments"
    :key="index"
  >
    <template v-if="segment.type === 'text'">
      {{ segment.value }}
    </template>
    <img
      v-else-if="showImage(segment.imageUrl)"
      class="chat-emote"
      :src="segment.imageUrl"
      :alt="segment.fallbackText || 'TikTok emote'"
      :title="segment.fallbackText || 'TikTok emote'"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error="markEmoteImageFailed(segment.imageUrl!)"
    >
    <template v-else>
      {{ segment.fallbackText }}
    </template>
  </template>
</template>

<style scoped>
.chat-emote {
  display: inline-block;
  width: 1.35em;
  height: 1.35em;
  margin: 0 0.08em;
  vertical-align: -0.3em;
  object-fit: contain;
}
</style>
