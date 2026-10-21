import { describe, expect, it } from 'vitest';
import { templateVariables, variableScopeFor } from './template-variables.ts';

describe('template variables', () => {
  it('derives a scope from the field name', () => {
    expect(variableScopeFor('webhookUrl')).toBe('all');
    expect(variableScopeFor('uniqueId')).toBe('identity');
    expect(variableScopeFor('soundFile')).toBe('file');
    expect(variableScopeFor('message')).toBe('text');
    expect(variableScopeFor('payload')).toBe('all');
  });

  it('offers registry paths, filtered by scope, plus globals', () => {
    const all = templateVariables({ trigger: 'tiktok.gift', scope: 'all', locale: 'en', globals: { score: '1' } });
    expect(all.some((variable) => variable.value === 'event.data.giftName')).toBe(true);
    expect(all.at(-1)).toEqual({ value: 'globals.score', label: 'score', detail: 'globals.score' });
    const identity = templateVariables({ trigger: 'tiktok.gift', scope: 'identity', locale: 'es' });
    expect(identity.length).toBeGreaterThan(0);
    expect(identity.every((variable) => /(uniqueId|userId|nickname|username|roomId|creator|user)$/i.test(variable.value))).toBe(true);
  });

  it('never repeats a path', () => {
    const values = templateVariables({ scope: 'all', locale: 'en' }).map((variable) => variable.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
