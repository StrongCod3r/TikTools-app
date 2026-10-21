import { defineStore } from 'pinia';
import { ref } from 'vue';
import { loadViewState, saveViewState } from '@/shared/lib/view-state.ts';
import type { AppTab } from '@/types.ts';

export const useNavigationStore = defineStore('navigation', () => {
  const activeTab = ref<AppTab>((loadViewState().tab as AppTab | undefined) ?? 'feed');

  function open(tab: AppTab): void {
    if (activeTab.value === tab) return;
    activeTab.value = tab;
    saveViewState('tab', tab);
  }

  return { activeTab, open };
});
