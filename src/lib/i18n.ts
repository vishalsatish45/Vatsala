import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

import en from '@/locales/en.json';
import hi from '@/locales/hi.json';
import kn from '@/locales/kn.json';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'hi', label: 'हिन्दी' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];

export function isLang(v: string | null | undefined): v is Lang {
  return LANGUAGES.some((l) => l.code === v);
}

/** Device language if we support it, else English. */
export function deviceLang(): Lang {
  const code = getLocales()[0]?.languageCode;
  return isLang(code) ? code : 'en';
}

/** BCP-47 locale for date formatting. */
export function localeFor(lang: string): string {
  return lang === 'kn' ? 'kn-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, kn: { translation: kn }, hi: { translation: hi } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
