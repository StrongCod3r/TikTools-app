import { expect, test } from 'bun:test';

import {
  DEFAULT_TTS_BUDGET_MS,
  MAX_TTS_BUDGET_MS,
  PROVIDER_TTS_BUDGETS_MS,
  classifyTtsOutcomeOrigin,
  formatBudgetMs,
  ttsBudgetMs,
} from './timeouts.ts';

test('provider budgets are the documented hypotheses', () => {
  expect(ttsBudgetMs('supertonic')).toBe(15_000);
  expect(ttsBudgetMs('pocket-tts')).toBe(60_000);
  expect(ttsBudgetMs('qwen3-gguf')).toBe(180_000);
});

test('unknown providers fall back to the conservative default', () => {
  expect(ttsBudgetMs('')).toBe(DEFAULT_TTS_BUDGET_MS);
  expect(ttsBudgetMs('mystery-tts')).toBe(DEFAULT_TTS_BUDGET_MS);
});

test('budgets stay inside the accepted ceiling', () => {
  for (const budget of Object.values(PROVIDER_TTS_BUDGETS_MS)) {
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThanOrEqual(MAX_TTS_BUDGET_MS);
  }
});

test('formatBudgetMs renders whole seconds', () => {
  expect(formatBudgetMs(180_000)).toBe('180s');
  expect(formatBudgetMs(15_000)).toBe('15s');
});

test('classifyTtsOutcomeOrigin distinguishes client vs server deadlines', () => {
  expect(classifyTtsOutcomeOrigin('HTTP request timed out after 180000 ms.')).toBe('client_deadline');
  expect(classifyTtsOutcomeOrigin('Inference cancelled or deadline exceeded')).toBe('cancellation');
  expect(classifyTtsOutcomeOrigin('server deadline reached')).toBe('server_deadline');
  expect(classifyTtsOutcomeOrigin('Server is busy. Too many pending inference requests.')).toBe('admission');
  expect(classifyTtsOutcomeOrigin('200 OK · 42 ms · http://localhost:17842')).toBe('none');
});
