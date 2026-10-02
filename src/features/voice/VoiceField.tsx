import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Mic, Square } from 'lucide-react-native';

import { Field, PressableScale, palette, radius } from '@/ui';

import { recognition, speechLocale } from './engines';

type Props = ComponentProps<typeof Field> & {
  value: string;
  onChangeText: (v: string) => void;
  /** `text` appends what was said; `number` replaces the value with the first number heard. */
  voiceMode?: 'text' | 'number';
};

/**
 * Field with a mic button: speak instead of typing, in the app language. Every mic on screen
 * hears the same native events, so each one only acts while it is the one listening.
 * Without the speech module in the build it is a plain Field.
 */
export function VoiceField({ voiceMode = 'text', value, onChangeText, ...field }: Props) {
  const { t, i18n } = useTranslation();
  const [listening, setListening] = useState(false);
  const mine = useRef(false);
  const latest = useRef({ value, onChangeText });
  useEffect(() => {
    latest.current = { value, onChangeText };
  }, [value, onChangeText]);

  useEffect(() => {
    const engine = recognition;
    if (!engine) return;
    const subs = [
      engine.addListener('result', (e) => {
        const heard = e.results[0]?.transcript?.trim();
        if (!mine.current || !e.isFinal || !heard) return;
        const { value: current, onChangeText: set } = latest.current;
        if (voiceMode === 'number') {
          const n = heard.replace(',', '.').match(/\d+(\.\d+)?/)?.[0];
          if (n) set(n);
        } else {
          set(current.trim() ? `${current.trim()} ${heard}` : heard);
        }
      }),
      engine.addListener('end', () => {
        mine.current = false;
        setListening(false);
      }),
      engine.addListener('error', (e) => {
        if (!mine.current) return;
        mine.current = false;
        setListening(false);
        if (e.error === 'not-allowed') Alert.alert(t('voice.noPermission'));
        else if (e.error === 'language-not-supported') Alert.alert(t('voice.noLanguage'));
      }),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      if (mine.current) engine.abort();
    };
  }, [voiceMode, t]);

  if (!recognition) return <Field value={value} onChangeText={onChangeText} {...field} />;
  const engine = recognition;

  async function toggle() {
    if (listening) {
      engine.stop();
      return;
    }
    const perm = await engine.requestPermissionsAsync();
    if (!perm.granted) return Alert.alert(t('voice.noPermission'));
    mine.current = true;
    setListening(true);
    engine.start({ lang: speechLocale(i18n.language), interimResults: false, continuous: false });
  }

  const mic = (
    <PressableScale
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={listening ? t('voice.stopListening') : t('voice.speak')}
      hitSlop={8}
      style={[styles.mic, listening && styles.micOn]}
    >
      {listening ? <Square size={16} color={palette.white} /> : <Mic size={18} color={palette.rose600} />}
    </PressableScale>
  );

  return <Field {...field} value={value} onChangeText={onChangeText} accessory={mic} hint={listening ? t('voice.listening') : field.hint} />;
}

const styles = StyleSheet.create({
  mic: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.rose50 },
  micOn: { backgroundColor: palette.rose500 },
});
