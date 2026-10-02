import { View } from 'react-native';
import { Pause, Play } from 'lucide-react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { AppText, PressableScale, palette } from '@/ui';

/** Plays a family voice note on the Care Team side. Loaded lazily — needs expo-audio. */
export default function VoicePlayer({ uri, seconds }: { uri: string; seconds?: number }) {
  const player = useAudioPlayer(uri);
  const st = useAudioPlayerStatus(player);
  return (
    <PressableScale
      onPress={() => {
        if (st.playing) player.pause();
        else {
          if (st.didJustFinish || st.currentTime >= st.duration) void player.seekTo(0);
          player.play();
        }
      }}
      accessibilityRole="button"
      accessibilityLabel="Play voice note"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.rose50, borderRadius: 999, padding: 10, alignSelf: 'flex-start' }}>
        {st.playing ? <Pause size={18} color={palette.rose600} /> : <Play size={18} color={palette.rose600} />}
        <AppText variant="label">Voice note{seconds ? ` · 0:${String(seconds).padStart(2, '0')}` : ''}</AppText>
      </View>
    </PressableScale>
  );
}
