import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Phone, PhoneCall, Volume2, VolumeX } from 'lucide-react-native';

import { askFamily, type FamilyAnswer } from '@/features/ai/familyAsk';
import { AiError } from '@/features/ai/remote';
import { LEARN, type LearnCard } from '@/features/family/learn';
import { birthHappened } from '@/features/family/stage';
import { useFamily } from '@/features/family/useFamily';
import { wellbeingFor } from '@/features/family/wellbeing';
import { speech, speechLocale } from '@/features/voice/engines';
import { VoiceField } from '@/features/voice/VoiceField';
import { isRemote } from '@/lib/supabase';
import { AppText, Button, Chip, GlassSurface, Screen, TopBar, palette, radius, space } from '@/ui';

type Turn = { id: number; question: string; answer?: FamilyAnswer; error?: string };

const SUGGESTIONS = ['family.ask.s.nextVisit', 'family.ask.s.bring', 'family.ask.s.medicines', 'family.ask.s.tests', 'family.ask.s.eat'] as const;

/**
 * Ask (Family face): questions about her own record and general care, answered from her record and the app's
 * education cards only (server `family-ask`). Never advice: anything clinical is sent to "Ask the hospital to call
 * me", and warning signs to 108. English only for now.
 */
export default function Ask() {
  const { t } = useTranslation();
  const { pregnancy, stage } = useFamily();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [readAloud, setReadAloud] = useState(true);
  const scroll = useRef<ScrollView>(null);
  // One question at a time: a second tap while an answer is on its way does nothing.
  const inFlight = useRef(false);
  const nextId = useRef(0);
  const [busy, setBusy] = useState(false);

  // Education the assistant may quote: the cards she would see in Learn and in "My diet & exercises".
  const delivered = birthHappened(pregnancy);
  const withBaby = stage === 'baby';
  const learnFor = (c: LearnCard) => (delivered ? c.stage !== 'pregnancy' : c.stage === 'pregnancy') && (!c.aboutBaby || withBaby);
  const topics = [...LEARN.filter(learnFor), ...wellbeingFor('diet', { birthHappened: delivered, withBaby }), ...wellbeingFor('exercise', { birthHappened: delivered, withBaby })]
    .slice(0, 40)
    .map((c) => ({ id: c.slug, title: c.title, text: [c.summary, ...c.body].join(' ').slice(0, 800) }));

  useEffect(() => () => void speech?.stop(), []);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const id = ++nextId.current;
    setTurns((all) => [...all, { id, question: q }]);
    setQuestion('');
    speech?.stop();
    try {
      const answer = await askFamily(q, topics);
      setTurns((all) => all.map((x) => (x.id === id ? { ...x, answer } : x)));
      if (readAloud) speech?.speak(answer.answer, { language: speechLocale('en') });
    } catch (e) {
      const message = e instanceof AiError ? e.message : t('auth.network');
      setTurns((all) => all.map((x) => (x.id === id ? { ...x, error: message } : x)));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (!isRemote) {
    return (
      <Screen withNav header={<TopBar large title={t('family.ask.title')} />}>
        <AppText tone="secondary">{t('family.ask.needsServer')}</AppText>
      </Screen>
    );
  }

  return (
    <Screen
      withNav
      blob="none"
      header={
        <TopBar
          large
          title={t('family.ask.title')}
          right={
            <Chip
              label={readAloud ? t('family.ask.voiceOn') : t('family.ask.voiceOff')}
              icon={readAloud ? Volume2 : VolumeX}
              variant="soft"
              onPress={() => {
                if (readAloud) speech?.stop();
                setReadAloud(!readAloud);
              }}
            />
          }
        />
      }
    >
      <AppText tone="secondary">{t('family.ask.intro')}</AppText>

      {turns.length === 0 && (
        <View style={styles.suggestions}>
          {SUGGESTIONS.map((k) => (
            <Chip key={k} label={t(k)} variant="soft" onPress={() => void ask(t(k))} />
          ))}
        </View>
      )}

      <ScrollView ref={scroll} contentContainerStyle={{ gap: space.sm }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} scrollEnabled={false}>
        {turns.map((turn) => (
          <View key={turn.id} style={{ gap: space.xs }}>
            <View style={[styles.bubble, styles.mine]}>
              <AppText variant="bodyMedium" style={{ color: palette.white }}>
                {turn.question}
              </AppText>
            </View>
            <GlassSurface strong radius={radius.lg} style={styles.bubble}>
              {!turn.answer && !turn.error && (
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                  <ActivityIndicator color={palette.rose500} />
                  <AppText tone="secondary">{t('family.ask.thinking')}</AppText>
                </View>
              )}
              {!!turn.error && <AppText tone="secondary">{turn.error}</AppText>}
              {turn.answer && <AnswerBody answer={turn.answer} />}
            </GlassSurface>
          </View>
        ))}
      </ScrollView>

      <VoiceField label={t('family.ask.label')} placeholder={t('family.ask.placeholder')} value={question} onChangeText={setQuestion} multiline maxLength={500} />
      <Button label={busy ? t('family.ask.thinking') : t('family.ask.send')} disabled={busy || !question.trim()} onPress={() => void ask(question)} />
      <AppText variant="caption" tone="faint" align="center">
        {t('family.ask.disclaimer')}
      </AppText>
    </Screen>
  );
}

function AnswerBody({ answer }: { answer: FamilyAnswer }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space.sm }}>
      <AppText>{answer.answer}</AppText>
      {answer.kind === 'urgent' && (
        <View style={{ gap: space.xs }}>
          <Button label={t('family.call108')} icon={Phone} onPress={() => Linking.openURL('tel:108')} />
          <Button variant="secondary" label={t('family.askCall')} icon={PhoneCall} onPress={() => router.push('/family/callback')} />
        </View>
      )}
      {answer.kind === 'refer' && <Button variant="secondary" label={t('family.askCall')} icon={PhoneCall} onPress={() => router.push('/family/callback')} />}
    </View>
  );
}

const styles = StyleSheet.create({
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  bubble: { padding: space.md, maxWidth: '92%' },
  mine: { alignSelf: 'flex-end', backgroundColor: palette.rose500, borderRadius: radius.lg },
});
