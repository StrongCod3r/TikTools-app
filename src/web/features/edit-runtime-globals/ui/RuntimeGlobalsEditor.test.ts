import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeControlClient, storePlugins } from '@/shared/lib/testing/fake-control-client.ts';
import { mountWithPlugins } from '@/shared/lib/testing/mount.ts';
import RuntimeGlobalsEditor from './RuntimeGlobalsEditor.vue';

enableAutoUnmount(afterEach);

async function mountEditor(handler: Parameters<typeof createFakeControlClient>[0]) {
  const { client, calls } = createFakeControlClient(handler);
  const wrapper = mountWithPlugins(RuntimeGlobalsEditor, { global: { plugins: storePlugins(client) } });
  await flushPromises();
  return { wrapper, calls };
}

function saveButton(wrapper: Awaited<ReturnType<typeof mountEditor>>['wrapper']) {
  return wrapper.findAll('button').find((button) => button.text() === 'Save globals')!;
}

describe('RuntimeGlobalsEditor', () => {
  it('loads globals into editable rows', async () => {
    const { wrapper } = await mountEditor(() => ({ globals: { commandPort: '46665' } }));
    const inputs = wrapper.findAll('input');
    expect(inputs.map((input) => input.element.value)).toEqual(['commandPort', '46665']);
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
  });

  it('saves edited values through the store', async () => {
    const { wrapper, calls } = await mountEditor((method) =>
      method === 'globals.list' ? { globals: { commandPort: '46665' } } : { ok: true },
    );
    await wrapper.findAll('input')[1]!.setValue('25575');
    await saveButton(wrapper).trigger('click');
    await flushPromises();
    expect(calls.at(-1)).toEqual({ method: 'globals.set', params: { key: 'commandPort', value: '25575' } });
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
  });

  it('explains invalid keys and blocks saving', async () => {
    const { wrapper } = await mountEditor(() => ({ globals: {} }));
    expect(wrapper.text()).toContain('No globals yet');
    await wrapper.findAll('button').find((button) => button.text() === 'Add global')!.trigger('click');
    await wrapper.findAll('input')[0]!.setValue('9lives');
    expect(wrapper.get('[role="alert"]').text()).toContain('Keys start with a letter');
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
  });

  it('removes a row', async () => {
    const { wrapper } = await mountEditor(() => ({ globals: { a: '1', b: '2' } }));
    await wrapper.findAll('button[aria-label="Remove global"]')[0]!.trigger('click');
    expect(wrapper.findAll('input').map((input) => input.element.value)).toEqual(['b', '2']);
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined();
  });
});
