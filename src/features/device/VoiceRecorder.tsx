import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Mic, Square, Trash2 } from 'lucide-react-native';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';

import { AppText, PressableScale, palette, radius, space } from '@/ui';

type Props = {
  /** All words come from the screen (i18n): the pill states, the microphone-blocked note and the delete button's label. */
  labels: { record: string; stop: string; saved: string; blocked: string; remove: string };
  onRecorded: (uri: string | undefined, seconds: number) => void;
  /** Recording started / stopped — the screen holds its Send button while a note is being recorded. */
  onRecording?: (recording: boolean) => void;
};

/** Voice-note pill (inspiration A "Start Talking"). Loaded lazily — needs expo-audio in the build. */
export default function VoiceRecorder({ labels, onRecorded, onRecording }: Props) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);
  const [saved, setSaved] = useState<number>();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    void setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  }, []);

  async function toggle() {
    if (state.isRecording) {
      await recorder.stop();
      onRecording?.(false);
      const uri = recorder.uri ?? undefined;
      const secs = Math.round(state.durationMillis / 1000);
      // If nothing was captured, treat as no recording so the user retries.
      if (!uri || secs < 1) {
        setSaved(undefined);
        onRecorded(undefined, 0);
        return;
      }
      setSaved(secs);
      onRecorded(uri, secs);
      return;
    }
    setDenied(false);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setDenied(true);
      return;
    }
    await recorder.prepareToRecordAsync();
    recorder.record();
    onRecording?.(true);
    setSaved(undefined);
  }

  const secs = Math.round(state.durationMillis / 1000);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <PressableScale onPress={toggle} style={{ flex: 1 }} accessibilityRole="button">
        <LinearGradient colors={state.isRecording ? [palette.rose300, palette.rose500] : ['#F9D3E1', palette.rose300]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.pill}>
          <View style={styles.mic}>{state.isRecording ? <Square size={16} color={palette.rose600} fill={palette.rose600} /> : <Mic size={18} color={palette.rose600} />}</View>
          <AppText variant="bodyMedium" tone={state.isRecording ? 'onPrimary' : 'primary'}>
            {state.isRecording ? `${labels.stop} · 0:${String(secs).padStart(2, '0')}` : saved != null ? `${labels.saved} · 0:${String(saved).padStart(2, '0')}` : labels.record}
          </AppText>
          {state.isRecording && (
            <View style={styles.wave}>
              {[6, 14, 9, 18, 11, 16, 7].map((h, i) => (
                <View key={i} style={[styles.bar, { height: h + ((secs + i) % 3) * 3 }]} />
              ))}
            </View>
          )}
        </LinearGradient>
      </PressableScale>
      {saved != null && !state.isRecording && (
        <PressableScale onPress={() => { setSaved(undefined); onRecorded(undefined, 0); }} accessibilityRole="button" accessibilityLabel={labels.remove}>
          <Trash2 size={20} color={palette.inkSoft} />
        </PressableScale>
      )}
      {denied && (
        <AppText variant="caption" tone="overdue">
          {labels.blocked}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.pill, padding: 8, paddingRight: space.lg },
  mic: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.white, alignItems: 'center', justifyContent: 'center' },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' },
  bar: { width: 3, borderRadius: 2, backgroundColor: palette.white },
});
