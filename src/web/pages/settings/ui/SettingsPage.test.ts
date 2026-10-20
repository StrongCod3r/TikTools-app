import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { legacyControllerKey, type LegacyController } from '@/composables/legacy-controller.ts';
import { createFakeControlClient, storePlugins } from '@/shared/lib/testing/fake-control-client.ts';
import { mountWithPlugins } from '@/shared/lib/testing/mount.ts';
import SettingsPage from './SettingsPage.vue';

enableAutoUnmount(afterEach);

async function mountPage(query = '') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/settings', component: defineComponent({ render: () => null }) }],
  });
  await router.push(`/settings${query}`);
  const locale = ref<'en' | 'es'>('en');
  const setLocale = vi.fn((value: 'en' | 'es') => (locale.value = value));
  const controller = { locale, setLocale } as unknown as LegacyController;
  const { client } = createFakeControlClient(() => ({ globals: { commandPort: '46665' } }));
  const wrapper = mountWithPlugins(SettingsPage, {
    attachTo: document.body,
    global: {
      plugins: [router, ...storePlugins(client)],
      provide: { [legacyControllerKey as symbol]: controller },
    },
  });
  await flushPromises();
  return { wrapper, router, setLocale };
}

describe('SettingsPage', () => {
  it('opens the general section with the language selector by default', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.get('[role="option"][aria-selected="true"]').text()).toBe('General');
    expect(wrapper.get('legend').text()).toBe('Language');
    expect(wrapper.get('#settings-language').text()).toContain('English');
  });

  it('switches the section through the route query', async () => {
    const { wrapper, router } = await mountPage();
    await wrapper.findAll('[role="option"]')[1]!.trigger('pointerdown');
    await flushPromises();
    expect(router.currentRoute.value.query.section).toBe('globals');
    expect(wrapper.get('legend').text()).toBe('Runtime globals');
    expect(wrapper.text()).toContain('{{ globals.key }}');
  });

  it('restores the section from the route query', async () => {
    const { wrapper } = await mountPage('?section=globals');
    expect(wrapper.findAll('input').map((input) => input.element.value)).toEqual(['commandPort', '46665']);
  });

  it('changes the application language', async () => {
    const { wrapper, setLocale } = await mountPage();
    await wrapper.get('#settings-language').trigger('click');
    document.querySelectorAll<HTMLElement>('[role="option"]').forEach((option) => {
      if (option.textContent?.trim() === 'Español') option.click();
    });
    await flushPromises();
    expect(setLocale).toHaveBeenCalledWith('es');
  });
});
