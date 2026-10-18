import { expect, test } from '@playwright/test';

import {
  baseFakeState,
  installFakeBroker,
  readBrokerCalls,
  readBrokerState,
} from './fixtures.ts';

test('boots from the broker: settings, voices, and outputs render', async ({ page }) => {
  const consoleCapture = await installFakeBroker(page, baseFakeState());
  await page.goto('/');

  await expect(page.getByLabel('Default voice')).toBeVisible();
  await expect(page.getByText('3 voices')).toBeVisible();
  await expect(page.getByLabel('Audio output').first()).toHaveValue('Speakers');

  const calls = await readBrokerCalls(page);
  const methods = calls.map((call) => call.method);
  expect(methods).toContain('settings.get');
  expect(methods).toContain('options.get');

  consoleCapture.assertClean();
});

test('voice tester executes speech and renders the log', async ({ page }) => {
  const state = baseFakeState();
  state.speakDelayMs = 400;
  const consoleCapture = await installFakeBroker(page, state);
  await page.goto('/');

  await expect(page.getByText('3 voices')).toBeVisible();
  await page.getByLabel('Voice', { exact: true }).selectOption('supertonic:M1');
  await page.getByLabel('Text', { exact: true }).fill('hello from ui suite');
  await page.getByRole('button', { name: 'Play' }).click();

  await expect(page.getByRole('button', { name: 'Speaking…' })).toBeVisible();
  await expect(page.getByRole('log')).toContainText('spoken', { timeout: 5_000 });

  const calls = await readBrokerCalls(page);
  const executed = calls.filter((call) => call.method === 'actions.execute');
  expect(executed.length).toBeGreaterThanOrEqual(1);
  expect(executed[0]?.params['action']).toBe('sonicboom.server.speak');
  expect(executed[0]?.params['config']).toMatchObject({
    text: 'hello from ui suite',
    voice: 'supertonic:M1',
  });

  consoleCapture.assertClean();
});

test('speech failure surfaces in the log without crashing', async ({ page }) => {
  const state = baseFakeState();
  state.speakOutcome = { ok: false, summary: 'synthesis failed', logs: [], error: 'voice not found' };
  const consoleCapture = await installFakeBroker(page, state);
  await page.goto('/');

  await expect(page.getByText('3 voices')).toBeVisible();
  await page.getByLabel('Text', { exact: true }).fill('this will fail');
  await page.getByRole('button', { name: 'Play' }).click();

  await expect(page.getByRole('log')).toContainText('voice not found', { timeout: 5_000 });
  await expect(page.getByLabel('Default voice')).toBeVisible();

  consoleCapture.assertClean();
});

test('rapid setting changes are coalesced before persistence', async ({ page }) => {
  const consoleCapture = await installFakeBroker(page, baseFakeState());
  await page.goto('/');

  const volume = page.getByLabel(/Volume/);
  await expect(volume).toBeVisible();
  for (let i = 0; i < 20; i += 1) {
    await volume.fill(String(Math.round((0.3 + i * 0.01) * 100) / 100));
  }
  await expect(page.getByText('49%')).toBeVisible();

  await expect
    .poll(async () => (await readBrokerCalls(page)).filter((call) => call.method === 'settings.set').length, {
      timeout: 5_000,
    })
    .toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(600);
  const writes = (await readBrokerCalls(page)).filter((call) => call.method === 'settings.set');
  expect(writes.length).toBeLessThan(20);

  const broker = await readBrokerState(page);
  const tts = broker.settings['tts'] as Record<string, unknown>;
  expect(tts['volume']).toBe(0.49);

  consoleCapture.assertClean();
});

test('output refresh re-reads devices and keeps the selection', async ({ page }) => {
  const consoleCapture = await installFakeBroker(page, baseFakeState());
  await page.goto('/');

  const outputs = page.getByLabel('Audio output').first();
  await expect(outputs).toHaveValue('Speakers');
  await page.getByRole('button', { name: 'Refresh outputs' }).click();

  await expect
    .poll(async () => {
      const calls = await readBrokerCalls(page);
      return calls.filter(
        (call) =>
          call.method === 'options.get' &&
          String(call.params['source']).endsWith(':device') &&
          call.params['refresh'] === true,
      ).length;
    })
    .toBeGreaterThanOrEqual(1);
  await expect(outputs).toHaveValue('Speakers');

  consoleCapture.assertClean();
});

test('one enabled provider hides selector and migrates old Supertonic setting', async ({ page }) => {
  await installFakeBroker(page, baseFakeState());
  await page.goto('/');
  await expect(page.getByText('3 voices')).toBeVisible();
  await expect(page.locator('#tts-provider')).toHaveCount(0);
  await expect(page.getByLabel('Default voice')).toHaveValue('supertonic:M1');
});

test('provider switching scopes default, tester, and special voices without unblocking users', async ({ page }) => {
  const state = baseFakeState();
  state.providers.push({ value: 'pocket-tts', label: 'Pocket TTS' }, { value: 'qwen3-gguf', label: 'Qwen3-TTS GGUF (loading)', disabled: true });
  state.voices.push({ value: 'pocket-tts:owned', label: 'My Pocket voice' });
  state.settings.tts = { enabled: true, defaultVoice: 'M1', specialUsers: [{ handle: 'blocked', allowed: false, voice: 'F2', speed: 1, pitch: 1 }] };
  await installFakeBroker(page, state);
  await page.goto('/');
  await expect(page.getByText('3 voices')).toBeVisible();
  await expect(page.locator('#tts-provider option[value="qwen3-gguf"]')).toBeDisabled();
  await page.getByLabel('Voice', { exact: true }).selectOption('supertonic:F2');
  await page.getByLabel('TTS provider').selectOption('pocket-tts');
  await expect(page.getByText('1 voices')).toBeVisible();
  await expect(page.locator('#tts-default-voice option[value^="supertonic:"]')).toHaveCount(0);
  await expect(page.getByLabel('Voice', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await readBrokerCalls(page)).filter(c => c.method === 'actions.execute').length).toBe(1);
  const action = (await readBrokerCalls(page)).find(c => c.method === 'actions.execute');
  expect(action?.params.config).toMatchObject({ provider: 'pocket-tts', voice: 'pocket-tts:owned' });
  await expect.poll(async () => ((await readBrokerState(page)).settings.tts as { providerId: string }).providerId).toBe('pocket-tts');
  const saved = (await readBrokerState(page)).settings.tts as { specialUsers: Array<{ allowed: boolean; voice: string }> };
  expect(saved.specialUsers[0]).toMatchObject({ allowed: false, voice: '' });
});

test('full reload refreshes both sources once, publishes new profile and invalidation revision', async ({ page }) => {
  await installFakeBroker(page, baseFakeState());
  await page.goto('/');
  await expect(page.getByText('3 voices')).toBeVisible();
  await page.evaluate(() => {
    const state = (window as unknown as { __SONICBOOM_STATE__: { voices: Array<{value:string;label:string}>; catalogDelayMs: number } }).__SONICBOOM_STATE__;
    state.voices.push({ value: 'supertonic:New', label: 'New' }); state.catalogDelayMs = 250;
  });
  await page.getByRole('button', { name: 'Refresh voices' }).click();
  await expect(page.getByRole('button', { name: 'Reloading…' })).toBeDisabled();
  await expect(page.getByText('4 voices')).toBeVisible();
  await expect(page.getByText('Voice catalog updated.')).toBeVisible();
  const refreshed = (await readBrokerCalls(page)).filter(c => c.method === 'options.get' && c.params.refresh === true);
  expect(refreshed.map(c => c.params.source).sort()).toEqual(['plugin-action-options:sonicboom.server.speak:provider', 'plugin-action-options:sonicboom.server.speak:voice']);
  const settings = (await readBrokerState(page)).settings.tts as { voiceCatalogRevision: string };
  expect(settings.voiceCatalogRevision).toMatch(/^[0-9a-f-]{36}$/);
});

test('reload error retains valid choices and remains retryable', async ({ page }) => {
  await installFakeBroker(page, baseFakeState());
  await page.goto('/');
  await expect(page.getByText('3 voices')).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __SONICBOOM_STATE__: { catalogError?: string } }).__SONICBOOM_STATE__.catalogError = 'HTTP 401'; });
  await page.getByRole('button', { name: 'Refresh voices' }).click();
  await expect(page.getByText('Reload failed: HTTP 401')).toBeVisible();
  await expect(page.getByLabel('Default voice')).toHaveValue('supertonic:M1');
  await expect(page.getByRole('button', { name: 'Refresh voices' })).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { __SONICBOOM_STATE__: { catalogError?: string } }).__SONICBOOM_STATE__.catalogError = undefined; });
  await page.getByRole('button', { name: 'Refresh voices' }).click();
  await expect(page.getByText('Voice catalog updated.')).toBeVisible();
});

test('switching provider during reload keeps the new selection', async ({ page }) => {
  const state = baseFakeState();
  state.providers.push({ value: 'pocket-tts', label: 'Pocket TTS' });
  state.voices.push({ value: 'pocket-tts:owned', label: 'Pocket voice' });
  await installFakeBroker(page, state);
  await page.goto('/');
  await expect(page.getByText('3 voices')).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __SONICBOOM_STATE__: { catalogDelayMs?: number } }).__SONICBOOM_STATE__.catalogDelayMs = 250; });
  await page.getByRole('button', { name: 'Refresh voices' }).click();
  await page.getByLabel('TTS provider').selectOption('pocket-tts');
  await expect(page.getByRole('button', { name: 'Refresh voices' })).toBeEnabled();
  await expect(page.getByLabel('TTS provider')).toHaveValue('pocket-tts');
  await expect(page.locator('#tts-default-voice option[value^="supertonic:"]')).toHaveCount(0);
});

test('server or token change clears old catalog on failed reload', async ({ page }) => {
  await installFakeBroker(page, baseFakeState());
  await page.goto('/');
  await expect(page.getByText('3 voices')).toBeVisible();
  await page.evaluate(() => {
    const state = (window as unknown as { __SONICBOOM_STATE__: { settings: Record<string, unknown>; catalogError?: string } }).__SONICBOOM_STATE__;
    state.settings.apiToken = 'different-test-tenant'; state.catalogError = 'HTTP 403';
  });
  await page.getByRole('button', { name: 'Refresh voices' }).click();
  await expect(page.getByText('Reload failed: HTTP 403')).toBeVisible();
  await expect(page.locator('#tts-default-voice option[value^="supertonic:"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
});

test('zero enabled providers and selected loading provider prevent speech', async ({ page }) => {
  const state = baseFakeState(); state.providers = []; state.voices = [];
  await installFakeBroker(page, state);
  await page.goto('/');
  await expect(page.getByText('Selected provider is unavailable.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
});

test('selected loading provider remains selected and cannot speak', async ({ page }) => {
  const state = baseFakeState();
  state.providers.push({ value: 'qwen3-gguf', label: 'Qwen3-TTS GGUF (loading)', disabled: true });
  state.settings.tts = { enabled: true, providerId: 'qwen3-gguf', defaultVoice: 'qwen3-gguf:old' };
  await installFakeBroker(page, state); await page.goto('/');
  await expect(page.getByLabel('TTS provider')).toHaveValue('qwen3-gguf');
  await expect(page.getByText('Selected provider is unavailable. (qwen3-gguf)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
});

test('deleting a cloned default reconciles all dropdowns and never sends empty voice', async ({ page }) => {
  const state = baseFakeState();
  state.providers = [{ value: 'pocket-tts', label: 'Pocket TTS' }];
  state.voices = [{ value: 'pocket-tts:first', label: 'First clone' }, { value: 'pocket-tts:second', label: 'Second clone' }];
  state.settings.tts = { enabled: true, providerId: 'pocket-tts', defaultVoice: 'pocket-tts:first' };
  await installFakeBroker(page, state); await page.goto('/');
  await expect(page.getByLabel('Default voice')).toHaveValue('pocket-tts:first');
  await page.evaluate(() => { const state = (window as unknown as { __SONICBOOM_STATE__: { voices: Array<{value:string;label:string}> } }).__SONICBOOM_STATE__; state.voices.shift(); });
  await page.getByRole('button', { name: 'Refresh voices' }).click();
  await expect(page.getByText('1 voices')).toBeVisible();
  await expect(page.locator('option[value="pocket-tts:first"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await readBrokerCalls(page)).filter(c => c.method === 'actions.execute').length).toBe(1);
  expect((await readBrokerCalls(page)).find(c => c.method === 'actions.execute')?.params.config).toMatchObject({ provider: 'pocket-tts', voice: 'pocket-tts:second' });
});

test('Spanish provider and reload controls are localized', async ({ page }) => {
  const state = baseFakeState(); state.locale = 'es';
  state.providers.push({ value: 'qwen3-gguf', label: 'Qwen3-TTS GGUF (loading)', disabled: true });
  await installFakeBroker(page, state); await page.goto('/');
  await expect(page.getByLabel('Proveedor TTS')).toBeVisible();
  await expect(page.locator('#tts-provider option[value="qwen3-gguf"]')).toHaveText('Qwen3-TTS GGUF (cargando)');
});

test('external settings event reloads profiles even when token stays redacted', async ({ page }) => {
  const state = baseFakeState(); state.settings.apiToken = '••••••••';
  await installFakeBroker(page, state); await page.goto('/');
  await expect(page.getByText('3 voices')).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __SONICBOOM_STATE__: { voices: Array<{value:string;label:string}> }; __SONICBOOM_EMIT_SETTINGS__: () => void };
    w.__SONICBOOM_STATE__.voices = [{ value: 'supertonic:Other', label: 'Other tenant voice' }];
    w.__SONICBOOM_EMIT_SETTINGS__();
  });
  await expect(page.getByText('1 voices')).toBeVisible();
  await expect(page.locator('option[value="supertonic:M1"]')).toHaveCount(0);
  await expect(page.locator('#tts-default-voice option[value="supertonic:Other"]')).toHaveCount(1);
});

test('diagnostics consume host events without refreshing catalogs and manual interruption is optional', async ({ page }) => {
  await installFakeBroker(page, baseFakeState());
  await page.goto('/');
  await expect(page.getByText('3 voices')).toBeVisible();
  const before = (await readBrokerCalls(page)).filter(call => call.method === 'options.get').length;
  await page.getByText('Speech diagnostics', { exact: true }).click();
  await page.evaluate(() => {
    const w = window as unknown as { __SONICBOOM_EMIT_DIAGNOSTIC__: (data: unknown) => void };
    w.__SONICBOOM_EMIT_DIAGNOSTIC__({pluginId:'sonicboom.server',eventType:'sonicboom.speech-status',event:{stage:'running',connection:'running',queueDepth:3,lastResult:'Playback disposition pending.'}});
  });
  await expect(page.getByText('Backend: running · Queue depth: 3')).toBeVisible();
  await expect(page.getByText('running · Playback disposition pending.')).toBeVisible();
  expect((await readBrokerCalls(page)).filter(call => call.method === 'options.get')).toHaveLength(before);
  await page.getByLabel('Text', { exact: true }).fill('manual check');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('spoken');
  let actions = (await readBrokerCalls(page)).filter(call => call.method === 'actions.execute');
  expect(actions[0]?.params['config']).toMatchObject({playNow:false});
  await page.getByLabel('Interrupt current speech for manual tests').check();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await readBrokerCalls(page)).filter(call => call.method === 'actions.execute').length).toBe(2);
  actions = (await readBrokerCalls(page)).filter(call => call.method === 'actions.execute');
  expect(actions[1]?.params['config']).toMatchObject({playNow:true});
});
