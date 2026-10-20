import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import type { ViewerRecord } from '../../../../shared/messages.ts';
import { useConnectionStore } from '@/entities/connection/model/connection-store.ts';
import { defaultPointsConfig } from '@/entities/points/model/default-config.ts';
import { usePointsStore } from '@/entities/points/model/points-store.ts';
import { createFakeControlClient, createStoreHarness } from '@/shared/lib/testing/fake-control-client.ts';
import { mountWithPlugins } from '@/shared/lib/testing/mount.ts';
import type { ConnectionStatus } from '@/types.ts';
import PointsPage from './PointsPage.vue';

enableAutoUnmount(afterEach);

beforeEach(() => {
  localStorage.clear();
});

function viewer(uniqueId: string, points: number): ViewerRecord {
  return {
    uniqueId,
    points,
    level: Math.floor(points / 100) + 1,
    isSubscriber: uniqueId === 'luna',
    totalChats: 0,
    totalCoins: 0,
    totalLikes: 0,
    totalShares: 0,
    firstSeen: 0,
    lastSeen: 0,
  };
}

async function mountPage(status: ConnectionStatus = 'idle') {
  const { client, calls } = createFakeControlClient((method, params) => {
    if (method === 'points.config.get') return defaultPointsConfig;
    if (method === 'points.config.set') return { ...defaultPointsConfig, ...params };
    if (method === 'points.leaderboard') return { viewers: [viewer('luna', 420), viewer('mango', 150)] };
    return {};
  });
  const stores = createStoreHarness(client);
  stores.use(() => useConnectionStore()).status = status;
  const wrapper = mountWithPlugins(PointsPage, { attachTo: document.body, global: { plugins: stores.plugins } });
  await wrapper.vm.$nextTick();
  const store = stores.use(() => usePointsStore());
  await store.refresh();
  await flushPromises();
  return { wrapper, calls };
}

function button(wrapper: Awaited<ReturnType<typeof mountPage>>['wrapper'], label: string) {
  return wrapper.findAll('button').find((entry) => entry.text() === label)!;
}

function documentButton(label: string): HTMLButtonElement {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((entry) => entry.textContent?.trim() === label)!;
}

describe('PointsPage', () => {
  it('lists the leaderboard with ranks, subscriber badges and the currency column', async () => {
    const { wrapper } = await mountPage();
    const rows = wrapper.findAll('.leaderboard-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('#1');
    expect(rows[0]!.text()).toContain('@luna');
    expect(rows[0]!.text()).toContain('SUB');
    expect(wrapper.findAll('th').map((th) => th.text())).toContain('Points');
    expect(wrapper.text()).toContain('2 viewers');
  });

  it('saves edited rules and disables saving until something changes', async () => {
    const { wrapper, calls } = await mountPage();
    expect(button(wrapper, 'Save rules').attributes('disabled')).toBeDefined();
    await wrapper.get('#points-currency').setValue('Gems');
    await button(wrapper, 'Save rules').trigger('click');
    await flushPromises();
    expect(calls.find((call) => call.method === 'points.config.set')?.params).toMatchObject({ currencyName: 'Gems' });
    expect(wrapper.findAll('th').map((th) => th.text())).toContain('Gems');
  });

  it('locks the rules while live', async () => {
    const { wrapper } = await mountPage('connected');
    expect(wrapper.text()).toContain('Rules are locked while LIVE');
    expect(wrapper.get('#points-currency').attributes('disabled')).toBeDefined();
    expect(button(wrapper, 'Reset all points').attributes('disabled')).toBeDefined();
  });

  it('deducts points for a viewer from the row menu', async () => {
    const { wrapper, calls } = await mountPage();
    await wrapper.get('button[aria-label="Actions for @mango"]').trigger('click');
    await nextTick();
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent?.includes('Deduct points'))!.click();
    await flushPromises();
    expect(document.querySelector('dialog h2')?.textContent).toContain('@mango');
    documentButton('Deduct points').click();
    await flushPromises();
    expect(calls.at(-1)).toEqual({ method: 'points.adjust', params: { uniqueId: 'mango', delta: -50 } });
  });

  it('confirms before resetting every viewer', async () => {
    const { wrapper, calls } = await mountPage();
    await button(wrapper, 'Reset all points').trigger('click');
    await flushPromises();
    expect(document.querySelector('dialog[open]')?.textContent).toContain('cannot be undone');
    documentButton('Reset').click();
    await flushPromises();
    expect(calls.some((call) => call.method === 'points.reset' && JSON.stringify(call.params) === '{}')).toBe(true);
  });

  it('filters the leaderboard from the search field', async () => {
    const { wrapper } = await mountPage();
    await wrapper.get('input[type="search"]').setValue('man');
    expect(wrapper.findAll('.leaderboard-table tbody tr').map((row) => row.text())).toEqual([expect.stringContaining('@mango')]);
  });
});
