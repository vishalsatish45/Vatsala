import { StyleSheet, View } from 'react-native';
import { LockKeyhole } from 'lucide-react-native';

import { AppText } from './AppText';
import { Atmosphere } from './Atmosphere';
import { Button } from './Button';
import { palette, space } from './tokens';

/** Full-screen lock over a face (Family app lock, Care Team idle lock). */
export function LockScreen({ title, body, unlockLabel, onUnlock, secondary }: { title: string; body: string; unlockLabel: string; onUnlock: () => void; secondary?: { label: string; onPress: () => void } }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Atmosphere blobCenterY={300} />
      <View style={styles.lock}>
        <LockKeyhole size={56} color={palette.rose600} strokeWidth={1.5} />
        <AppText variant="display" align="center">
          {title}
        </AppText>
        <AppText tone="secondary" align="center">
          {body}
        </AppText>
        <Button label={unlockLabel} onPress={onUnlock} />
        {secondary && <Button variant="secondary" label={secondary.label} onPress={secondary.onPress} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ lock: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md } });
