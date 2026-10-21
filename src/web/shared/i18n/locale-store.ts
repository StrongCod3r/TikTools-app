import { defineStore } from 'pinia';
import { computed } from 'vue';
import { activateLocale, i18n, type Locale } from './i18n.ts';
import { storeLocale } from './locale-preference.ts';

export const useLocaleStore = defineStore('locale', () => {
  const locale = computed<Locale>(() => i18n.global.locale.value);

  async function setLocale(next: Locale): Promise<void> {
    if (next === locale.value) return;
    storeLocale(next);
    await activateLocale(next);
  }

  return { locale, setLocale };
});
