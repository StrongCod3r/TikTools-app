import { afterEach, describe, expect, it } from 'vitest';
import { detectLocale, storedLocale, storeLocale } from './locale-preference.ts';

afterEach(() => {
  localStorage.clear();
});

describe('locale preference', () => {
  it('prefers the stored locale', () => {
    storeLocale('es');
    expect(storedLocale()).toBe('es');
    expect(detectLocale(['en-US'])).toBe('es');
  });

  it('ignores unsupported stored values', () => {
    localStorage.setItem('tiktok-live-locale', 'fr');
    expect(storedLocale()).toBeNull();
  });

  it('matches the first supported system language', () => {
    expect(detectLocale(['fr-FR', 'es-MX', 'en-US'])).toBe('es');
    expect(detectLocale(['de-DE'])).toBe('en');
  });
});
