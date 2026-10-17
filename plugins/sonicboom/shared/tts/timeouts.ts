/**
 * Provider-aware SonicBoom speech budgets (single source of truth).
 *
 * These are the *synchronous fallback* budgets: the maximum time the client is
 * willing to hold one `/api/tts/play` request open while the server synthesizes.
 * They mirror, and must stay in lock-step with:
 *
 * - `plugins/sonicboom/plugin.json` → `sonicboom.server.speak` `http.timeoutByField`
 * - `plugins/sonicboom/backend/src/main.rs` → `provider_timeout_budget`
 * - SonicBoom's own server-side generation deadline (the effective deadline is
 *   always the smallest of client budget, server deadline and transport clamp).
 *
 * They are honest starting hypotheses, not performance guarantees. Prefer the
 * async jobs API (`/api/tts/jobs`) for slow providers so no single HTTP call is
 * held open for the whole synthesis.
 */

/** Default budget for an unknown provider (Supertonic-compatible). */
export const DEFAULT_TTS_BUDGET_MS = 15_000;

/** Hard ceiling accepted by the host manifest and executor for TTS actions. */
export const MAX_TTS_BUDGET_MS = 180_000;

/**
 * Per-provider synchronous budgets in milliseconds. Keys are the qualified
 * provider ids used by the server and the plugin catalog.
 */
export const PROVIDER_TTS_BUDGETS_MS: Readonly<Record<string, number>> = Object.freeze({
  supertonic: 15_000,
  'pocket-tts': 60_000,
  'qwen3-gguf': MAX_TTS_BUDGET_MS,
});

/**
 * Effective synchronous budget for a provider id. Unknown providers get the
 * conservative default rather than an unbounded wait. The result is always
 * within `[1, MAX_TTS_BUDGET_MS]`.
 */
export function ttsBudgetMs(providerId: string): number {
  const budget = PROVIDER_TTS_BUDGETS_MS[providerId];
  if (typeof budget !== 'number' || !Number.isFinite(budget)) return DEFAULT_TTS_BUDGET_MS;
  return Math.max(1, Math.min(MAX_TTS_BUDGET_MS, Math.trunc(budget)));
}

/** Human-readable budget for diagnostics, e.g. `180s`. */
export function formatBudgetMs(budgetMs: number): string {
  return `${Math.round(budgetMs / 1000)}s`;
}

/** Where a failed speech attempt stopped, derived from a redacted summary. */
export type TtsTimeoutOrigin =
  | 'client_deadline'
  | 'server_deadline'
  | 'admission'
  | 'cancellation'
  | 'none';

/**
 * Classifies a redacted error summary into a timeout/ownership origin so the
 * tester can tell a client deadline from server admission or cancellation.
 * Pure string matching: never inspects or emits payloads.
 */
export function classifyTtsOutcomeOrigin(summary: string): TtsTimeoutOrigin {
  const text = summary.toLowerCase();
  if (/timed out after \d+ ms/.test(text)) return 'client_deadline';
  if (text.includes('cancelled') || text.includes('canceled')) return 'cancellation';
  if (text.includes('deadline')) return 'server_deadline';
  if (text.includes('busy') || text.includes('too many pending') || text.includes('admission')) {
    return 'admission';
  }
  return 'none';
}

