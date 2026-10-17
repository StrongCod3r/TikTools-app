import { expect, test } from '@playwright/test';

import { assertNoUnhandledCalls, emitTopic, installFakeHost } from './fixtures/tiktools-host.ts';
import { emptyState } from './fixtures/states.ts';

test('feed rows stay badge-free and open details in the shared panel', async ({ page }) => {
  const capture = await installFakeHost(page, emptyState());
  await page.goto('/');

  await emitTopic(page, 'live.ui-event', {
    event: {
      kind: 'gift',
      author: 'flor',
      nickname: 'Flor',
      text: 'sent a gift',
      msgId: 'aside-gift-1',
      level: 12,
      pointsDelta: 1.5,
      giftDetails: { name: 'Rose', count: 1, diamonds: 1 },
    },
  });

  const row = page.locator('.tiktok-chat-row').first();
  await expect(row).toBeVisible();
  // Level and points are details, not row decoration.
  await expect(row.locator('.tt-badge-level')).toHaveCount(0);
  await expect(row.locator('.tt-points-badge')).toHaveCount(0);
  // The timestamp is always visible, even when points were earned.
  await expect(row.locator('.tt-timestamp')).toBeVisible();

  await row.locator('.tt-row-content').click();
  await expect(page.locator('.feed-details')).toBeVisible();
  await expect(page.locator('.feed-details')).toContainText('Level');
  await expect(page.locator('.feed-details')).toContainText('Points earned');
  await expect(page.locator('.feed-details')).toContainText('Rose');

  // Escape closes the panel and returns focus to the row's control.
  await page.keyboard.press('Escape');
  await expect(page.locator('.feed-details')).toHaveCount(0);

  await assertNoUnhandledCalls(page);
  capture.assertClean();
});

test('the avatar opens the user profile in the same panel', async ({ page }) => {
  const capture = await installFakeHost(page, emptyState());
  await page.goto('/');

  await emitTopic(page, 'live.ui-event', {
    event: { kind: 'chat', author: 'alice', nickname: 'Alice', text: 'hola', msgId: 'aside-chat-1' },
  });

  await page.locator('.tiktok-chat-row').first().locator('.tt-user-chip').click();
  await expect(page.locator('.feed-aside .tt-user-card')).toBeVisible();
  await expect(page.locator('.feed-aside')).toContainText('@alice');

  await assertNoUnhandledCalls(page);
  capture.assertClean();
});
