import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { AppText, Button, palette, space } from '@/ui';

/** Loaded lazily (React.lazy) so builds without expo-camera don't crash at startup. */
export default function QrScanner({ onScan }: { onScan: (data: string) => void }) {
  const [perm, request] = useCameraPermissions();
  if (!perm) return null;
  if (!perm.granted) {
    return (
      <View style={styles.center}>
        <AppText align="center" tone="secondary">
          Camera permission is needed to scan a patient QR.
        </AppText>
        <Button label="Allow camera" onPress={request} />
      </View>
    );
  }
  return (
    <View style={styles.frame}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => onScan(data)} />
      <View style={styles.reticle} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { gap: space.md, padding: space.lg },
  frame: { height: 360, borderRadius: 28, overflow: 'hidden', backgroundColor: palette.ink },
  reticle: { position: 'absolute', top: 70, left: 60, right: 60, bottom: 70, borderWidth: 3, borderColor: palette.white, borderRadius: 24, opacity: 0.85 },
});
