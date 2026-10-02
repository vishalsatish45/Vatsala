import { requireOptionalNativeModule } from 'expo';

/**
 * Voice engines, loaded only when the native module is in the installed build. A dev build made
 * before these packages were added would otherwise crash at import, so the voice buttons simply
 * hide until the app is rebuilt (`npm run android`).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- a static import would crash an old build at load time */
type SpeechRecognition = typeof import('expo-speech-recognition');
type Speech = typeof import('expo-speech');

export const recognition: SpeechRecognition['ExpoSpeechRecognitionModule'] | undefined = requireOptionalNativeModule('ExpoSpeechRecognition')
  ? (require('expo-speech-recognition') as SpeechRecognition).ExpoSpeechRecognitionModule
  : undefined;

export const speech: Speech | undefined = requireOptionalNativeModule('ExpoSpeech') ? (require('expo-speech') as Speech) : undefined;

/** App language → BCP-47 tag understood by both the Android speech recogniser and text-to-speech. */
export function speechLocale(lang: string): string {
  return lang === 'kn' ? 'kn-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN';
}
