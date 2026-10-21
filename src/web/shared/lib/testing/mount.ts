import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import type { Component } from 'vue';
import { i18n } from '@/shared/i18n/i18n.ts';

export function mountWithPlugins<C extends Component>(component: C, options: ComponentMountingOptions<C> = {}) {
  return mount(component, {
    ...options,
    global: { ...options.global, plugins: [i18n, ...(options.global?.plugins ?? [])] },
  } as ComponentMountingOptions<C>);
}
