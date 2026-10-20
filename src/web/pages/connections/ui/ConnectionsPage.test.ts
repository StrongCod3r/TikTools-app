import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { legacyControllerKey, type LegacyController } from '@/composables/legacy-controller.ts';
import { createFakeControlClient, storePlugins } from '@/shared/lib/testing/fake-control-client.ts';
import { mountWithPlugins } from '@/shared/lib/testing/mount.ts';
import type { ConnectionStatus, LiveChannel } from '@/types.ts';
import ConnectionsPage from './ConnectionsPage.vue';

enableAutoUnmount(afterEach);

beforeEach(() => {
  localStorage.clear();
});

const rooms: LiveChannel[] = [
  { uniqueId: 'luna', roomId: '1', nickname: 'Luna', title: 'Late night chill', viewers: 1520 },
  { uniqueId: 'mango', roomId: '2', nickname: 'Mango', title: '', viewers: 0 },
];

function fakeController(status: ConnectionStatus) {
  const uniqueId = ref('');
  return {
    uniqueId,
    cookie: ref(''),
    status: ref(status),
    activeCreator: ref(status === 'connected' ? 'luna' : ''),
    recents: ref(['luna', 'mango']),
    error: ref(''),
    reconnectAttempt: ref(null),
    maxReconnectAttempts: 5,
    behavior: ref({ plugins: [] }),
    pluginConnections: ref({}),
    locale: ref('en'),
    setUniqueId: vi.fn((value: string) => (uniqueId.value = value)),
    setCookie: vi.fn(),
    handleConnect: vi.fn(),
    handleDisconnect: vi.fn(),
    handleReconnect: vi.fn(),
    handlePickLive: vi.fn(),
    handleSelectRecent: vi.fn(),
    handleConnectRoom: vi.fn(),
  };
}

async function mountPage(status: ConnectionStatus = 'idle') {
  const controller = fakeController(status);
  const { client, calls } = createFakeControlClient(() => ({ rooms, fetchedAt: Date.now(), source: 'test' }));
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:any(.*)*', component: { render: () => null } }] });
  const wrapper = mountWithPlugins(ConnectionsPage, {
    attachTo: document.body,
    global: {
      plugins: [router, ...storePlugins(client)],
      provide: { [legacyControllerKey as symbol]: controller as unknown as LegacyController },
    },
  });
  await flushPromises();
  return { wrapper, controller, calls };
}

function buttonByText(wrapper: Awaited<ReturnType<typeof mountPage>>['wrapper'], text: string) {
  return wrapper.findAll('button').find((button) => button.text() === text)!;
}

describe('ConnectionsPage', () => {
  it('connects to the typed creator', async () => {
    const { wrapper, controller } = await mountPage();
    expect(buttonByText(wrapper, 'Connect').attributes('disabled')).toBeDefined();
    await wrapper.get('#live-handle').setValue('luna');
    expect(controller.setUniqueId).toHaveBeenCalledWith('luna');
    await buttonByText(wrapper, 'Connect').trigger('click');
    expect(controller.handleConnect).toHaveBeenCalled();
  });

  it('offers recent creators and a random room', async () => {
    const { wrapper, controller } = await mountPage();
    await wrapper.get('button[aria-label="Recent creators"]').trigger('click');
    await nextTick();
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(items.map((item) => item.textContent?.trim())).toEqual(['@luna', '@mango']);
    items[1]!.click();
    expect(controller.handleSelectRecent).toHaveBeenCalledWith('mango');
    await wrapper.get('button[aria-label="Connect to a random LIVE"]').trigger('click');
    expect(controller.handlePickLive).toHaveBeenCalled();
  });

  it('reveals the cookie field on demand', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find('#live-cookie').exists()).toBe(false);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(wrapper.get('#live-cookie').attributes('type')).toBe('password');
  });

  it('locks the form and offers disconnect while live', async () => {
    const { wrapper, controller } = await mountPage('connected');
    expect(wrapper.get('#live-handle').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Receiving events from @luna.');
    await buttonByText(wrapper, 'Disconnect').trigger('click');
    expect(controller.handleDisconnect).toHaveBeenCalled();
  });

  it('only browses rooms after opening the explorer', async () => {
    const { wrapper, calls, controller } = await mountPage();
    expect(calls).toHaveLength(0);
    await buttonByText(wrapper, 'Explore').trigger('click');
    await flushPromises();
    expect(calls[0]?.method).toBe('live.channels');
    const rows = wrapper.findAll('.live-explorer tbody tr');
    expect(rows.map((row) => row.text())).toEqual([expect.stringContaining('@luna'), expect.stringContaining('@mango')]);
    expect(rows[0]!.text()).toContain('1,520');
    await rows[1]!.get('button').trigger('click');
    expect(controller.handleConnectRoom).toHaveBeenCalledWith(rooms[1]);
  });

  it('points to plugins when no server connection exists', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.text()).toContain('No server connections yet');
    expect(buttonByText(wrapper, 'Open plugins').exists()).toBe(true);
  });
});
