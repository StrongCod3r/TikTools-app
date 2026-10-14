import { expect, test } from '@playwright/test';
import { assertNoUnhandledCalls, emitTopic, installFakeHost } from './fixtures/tiktools-host.ts';
import { emptyState } from './fixtures/states.ts';

test('feed appends only format new cards and still update locale, search, and clear', async ({ page }) => {
  const capture = await installFakeHost(page, emptyState());
  await page.addInitScript(() => {
    const target = window as typeof window & { feedFormatCalls: number };
    target.feedFormatCalls = 0;
    const descriptor = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format')!;
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', {
      ...descriptor,
      get() {
        const format = descriptor.get!.call(this) as (date?: number | Date) => string;
        return (date?: number | Date) => {
          target.feedFormatCalls += 1;
          return format(date);
        };
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('No live events yet.')).toBeVisible();
  const emitChat = (index: number) => emitTopic(page, 'live.ui-event', {
    event: { kind: 'chat', author: 'alice', text: `feed message ${index}`, msgId: `feed-${index}` },
  });
  await emitChat(1);
  await expect(page.locator('.tiktok-chat-row')).toHaveCount(1);
  await page.evaluate(() => { (window as typeof window & { feedFormatCalls: number }).feedFormatCalls = 0; });
  await emitChat(2);
  await expect(page.locator('.tiktok-chat-row')).toHaveCount(2);
  expect(await page.evaluate(() => (window as typeof window & { feedFormatCalls: number }).feedFormatCalls)).toBe(1);

  await page.getByRole('button', { name: /Switch Language/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect.poll(() => page.evaluate(() => (window as typeof window & { feedFormatCalls: number }).feedFormatCalls)).toBe(3);
  await page.locator('.feed-toolbar input').fill('message 2');
  await expect(page.locator('.tiktok-chat-row')).toHaveCount(1);
  await expect(page.locator('.tiktok-chat-row')).toContainText('feed message 2');
  await page.locator('.feed-toolbar input').fill('');
  await expect(page.locator('.tiktok-chat-row')).toHaveCount(2);
  await page.getByRole('button', { name: /Limpiar/ }).click();
  await expect(page.locator('.tiktok-chat-row')).toHaveCount(0);
  await assertNoUnhandledCalls(page);
  capture.assertClean();
});
