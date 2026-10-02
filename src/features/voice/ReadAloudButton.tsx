import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Square, Volume2 } from 'lucide-react-native';

import { GlassIconButton } from '@/ui';

import { speech, speechLocale } from './engines';

/**
 * Speaker button for a top bar: reads `text` aloud in the app language, tap again to stop.
 * Hidden when the build has no text-to-speech module. Speech stops when the screen closes.
 */
export function ReadAloudButton({ text }: { text: string }) {
  const { t, i18n } = useTranslation();
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => void speech?.stop(), []);

  if (!speech) return null;
  const engine = speech;

  function toggle() {
    if (speaking) {
      void engine.stop();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    engine.speak(text, {
      language: speechLocale(i18n.language),
      rate: 0.9,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }

  return <GlassIconButton icon={speaking ? Square : Volume2} accessibilityLabel={speaking ? t('voice.stopReading') : t('voice.readAloud')} onPress={toggle} />;
}
