// core/Language.ts: the string layer, as web lib/i18n (languages.ts). Pure: the saved choice and the device
// language are read by AppContainer and handed in. Strings come from core/Strings.ts (tools/make-strings.py).
import { STRINGS } from './Strings';

export type ResolvedLanguage = 'en' | 'th' | 'ja';
export type LanguagePreference = 'system' | ResolvedLanguage;

export const SUPPORTED_LANGUAGES: ResolvedLanguage[] = ['en', 'th', 'ja'];

/** Each language in its own script, as web's LANGUAGE_NAMES. */
export const LANGUAGE_NAMES: Record<string, string> = { en: 'English', th: 'ไทย', ja: '日本語' };

export function isLanguagePreference(value: string): boolean {
  return value === 'system' || (SUPPORTED_LANGUAGES as string[]).includes(value);
}

/** A stored value that is not a choice reads as "system", as web does. */
export function normaliseLanguagePreference(value: string): LanguagePreference {
  return isLanguagePreference(value) ? value as LanguagePreference : 'system';
}

/** The base subtag of a device language tag (`th-TH`, `ja_JP`) if supported, else English. */
export function resolveLanguage(preference: string, deviceTag: string): ResolvedLanguage {
  const wanted: string = preference === 'system' ? deviceTag : preference;
  const base: string = wanted.toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LANGUAGES as string[]).includes(base) ? base as ResolvedLanguage : 'en';
}

let current: ResolvedLanguage = 'en';

export function setCurrentLanguage(language: ResolvedLanguage): void {
  current = language;
}

export function currentLanguage(): ResolvedLanguage {
  return current;
}

/** The string for `key` in the current language, then English, then `fallback` (for text with no web key yet). */
export function t(key: string, fallback: string = ''): string {
  const own: string | undefined = STRINGS[current][key];
  if (own !== undefined) {
    return own;
  }
  const english: string | undefined = STRINGS.en[key];
  return english !== undefined ? english : fallback;
}
