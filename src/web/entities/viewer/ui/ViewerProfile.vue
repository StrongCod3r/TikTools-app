<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatCount, intlLocale } from '@/shared/lib/intl.ts';
import type { UserCardUser } from '@/types.ts';
import ViewerAvatar from './ViewerAvatar.vue';

const props = withDefaults(
  defineProps<{
    viewer: UserCardUser;
    images?: boolean;
  }>(),
  { images: true },
);

const { t, locale } = useI18n();

const handle = computed(() => props.viewer.uniqueId.replace(/^@+/, ''));
const name = computed(() =>
  props.viewer.nickname && props.viewer.nickname !== handle.value ? props.viewer.nickname : `@${handle.value}`,
);

const stats = computed(() =>
  (
    [
      ['points', props.viewer.points],
      ['chats', props.viewer.totalChats],
      ['coins', props.viewer.totalCoins],
      ['likes', props.viewer.totalLikes],
      ['shares', props.viewer.totalShares],
    ] as const
  )
    .filter((entry): entry is [typeof entry[0], number] => typeof entry[1] === 'number')
    .map(([key, value]) => ({ key, label: t(`feed.profile.stats.${key}`), value: formatCount(value, locale.value) })),
);

function stamp(value: number): string {
  return new Date(value).toLocaleString(intlLocale(locale.value), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <div class="viewer-profile">
    <div class="viewer-profile__identity">
      <ViewerAvatar
        :handle="handle"
        :src="images ? viewer.avatarUrl : undefined"
        :size="44"
      />
      <span class="viewer-profile__names">
        <strong>{{ name }}</strong>
        <span class="viewer-profile__handle">@{{ handle }}</span>
      </span>
      <span class="viewer-profile__level">{{ t('feed.profile.level', { level: viewer.level ?? 1 }) }}</span>
    </div>
    <span
      v-if="viewer.isSubscriber"
      class="viewer-profile__badge"
    >{{ t('feed.profile.subscriber') }}</span>
    <dl
      v-if="stats.length"
      class="viewer-profile__stats"
    >
      <div
        v-for="stat in stats"
        :key="stat.key"
        class="viewer-profile__stat"
      >
        <dd>{{ stat.value }}</dd>
        <dt>{{ stat.label }}</dt>
      </div>
    </dl>
    <p
      v-else
      class="viewer-profile__empty"
    >
      {{ t('feed.profile.noStats') }}
    </p>
    <slot />
    <footer
      v-if="viewer.firstSeen || viewer.lastSeen"
      class="viewer-profile__seen"
    >
      <span v-if="viewer.firstSeen">{{ t('feed.profile.firstSeen', { time: stamp(viewer.firstSeen) }) }}</span>
      <span v-if="viewer.lastSeen">{{ t('feed.profile.lastSeen', { time: stamp(viewer.lastSeen) }) }}</span>
    </footer>
  </div>
</template>

<style scoped>
.viewer-profile {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.viewer-profile__identity {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.viewer-profile__names {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.viewer-profile__handle {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.viewer-profile__level {
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.viewer-profile__badge {
  align-self: flex-start;
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--color-chart-3);
  border-radius: var(--radius-sm);
  color: var(--color-chart-3);
  font-size: var(--font-size-sm);
}

.viewer-profile__stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: var(--space-2);
  margin: 0;
}

.viewer-profile__stat {
  display: flex;
  flex-direction: column-reverse;
  gap: var(--space-1);
  padding: var(--space-3);
  border: var(--border-width) solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-bg-raised);
}

.viewer-profile__stat dd {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.viewer-profile__stat dt {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.viewer-profile__empty {
  margin: 0;
  color: var(--color-text-subtle);
}

.viewer-profile__seen {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--color-text-subtle);
  font-size: var(--font-size-sm);
}
</style>
