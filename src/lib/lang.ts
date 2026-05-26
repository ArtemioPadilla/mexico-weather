/**
 * Language helpers — Story 6.1.
 *
 * Single source of truth for the user's chosen language. Persists
 * via sessionStorage (NOT localStorage — language is a per-session
 * preference, not a permanent identity). Falls back to navigator.
 * language on first visit, then defaults to 'es'.
 *
 * The actual string lookups still go through src/i18n/ui.ts; this
 * module just owns the lang-resolution + persistence.
 */
export type Lang = 'es' | 'en';

export const LANG_KEY = 'mw:lang';

/** Read the persisted lang, or infer from navigator.language, or
 *  fall back to 'es'. Safe to call before DOM ready. */
export function readLang(): Lang {
  try {
    const stored = sessionStorage.getItem(LANG_KEY);
    if (stored === 'en' || stored === 'es') return stored;
  } catch {
    /* private mode / SSR — fall through */
  }
  try {
    const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
    if (nav.toLowerCase().startsWith('en')) return 'en';
  } catch {
    /* ignore */
  }
  return 'es';
}

export function writeLang(lang: Lang): void {
  try {
    sessionStorage.setItem(LANG_KEY, lang);
  } catch {
    /* silent */
  }
}
