/**
 * PulseGuard — I18n Context (fr/en)
 *
 * Homemade i18n: context + JSON dictionaries.
 * Detects locale from navigator.language, fallback fr.
 * Manual override persisted in localStorage.
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import fr from './fr.json';
import en from './en.json';

export type Locale = 'fr' | 'en';

const DICTS: Record<Locale, Record<string, string>> = {
  fr: fr as Record<string, string>,
  en: en as Record<string, string>,
};

const STORAGE_KEY = 'dg_locale';

export function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'fr' || stored === 'en') return stored;
  const nav = navigator.language?.toLowerCase() ?? '';
  return nav.startsWith('en') ? 'en' : 'fr';
}

export interface I18nContextValue {
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      return detectLocale();
    } catch {
      return 'fr';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch { /* ignore */ }
  }, [locale]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = DICTS[locale];
      let str = dict[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return str;
    },
    [locale],
  );

  const setLocale = useCallback((l: Locale) => setLocaleState(l), []);
  const toggleLocale = useCallback(() => setLocaleState(prev => prev === 'fr' ? 'en' : 'fr'), []);

  return (
    <I18nContext.Provider value={{ locale, t, setLocale, toggleLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

export { DICTS };
