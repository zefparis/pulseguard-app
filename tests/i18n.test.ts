/**
 * PulseGuard — i18n tests
 *
 * Tests:
 * 1. Every key in fr.json has a counterpart in en.json (and vice versa)
 * 2. detectLocale: navigator.language 'en-ZA' → 'en', 'fr-FR' → 'fr', other → 'fr'
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fr from '../src/i18n/fr.json';
import en from '../src/i18n/en.json';
import { detectLocale } from '../src/i18n/I18nContext';

// ─── 1. Key parity ───────────────────────────────────────────────

describe('i18n — dictionary key parity', () => {
  it('every key in fr.json exists in en.json', () => {
    const frKeys = Object.keys(fr);
    const enKeys = new Set(Object.keys(en));
    const missing = frKeys.filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('every key in en.json exists in fr.json', () => {
    const enKeys = Object.keys(en);
    const frKeys = new Set(Object.keys(fr));
    const missing = enKeys.filter((k) => !frKeys.has(k));
    expect(missing).toEqual([]);
  });
});

// ─── 2. Locale detection ─────────────────────────────────────────

describe('i18n — locale detection', () => {
  const originalLanguage = navigator.language;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'language', {
      value: originalLanguage,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  function setNavigatorLanguage(lang: string) {
    Object.defineProperty(navigator, 'language', {
      value: lang,
      configurable: true,
    });
  }

  it('en-ZA → english', () => {
    setNavigatorLanguage('en-ZA');
    vi.spyOn(localStorage, 'getItem').mockReturnValue(null);
    expect(detectLocale()).toBe('en');
  });

  it('fr-FR → french', () => {
    setNavigatorLanguage('fr-FR');
    vi.spyOn(localStorage, 'getItem').mockReturnValue(null);
    expect(detectLocale()).toBe('fr');
  });

  it('other (de-DE) → fallback french', () => {
    setNavigatorLanguage('de-DE');
    vi.spyOn(localStorage, 'getItem').mockReturnValue(null);
    expect(detectLocale()).toBe('fr');
  });

  it('manual override in localStorage takes priority over navigator.language', () => {
    setNavigatorLanguage('fr-FR');
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    spy.mockImplementation((key: string) =>
      key === 'dg_locale' ? 'en' : null,
    );
    expect(detectLocale()).toBe('en');
    spy.mockRestore();
  });
});
