import { Linking, StyleSheet, View } from 'react-native';
import { Ambulance, Phone } from 'lucide-react-native';

import { Button } from './Button';
import { space } from './tokens';

export const HOSPITAL_PHONE = '08022220000';

/** Always-visible call buttons for families (PRD F-42, F-48). */
export function EmergencyButtons({ call108, callHospital }: { call108: string; callHospital: string }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Button label={call108} icon={Ambulance} onPress={() => Linking.openURL('tel:108')} />
      </View>
      <View style={{ flex: 1 }}>
        <Button variant="secondary" label={callHospital} icon={Phone} onPress={() => Linking.openURL(`tel:${HOSPITAL_PHONE}`)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: space.sm } });
