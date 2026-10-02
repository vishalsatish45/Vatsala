import { useState } from 'react';
import { Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useDb } from '@/data/store';
import type { CaregiverScopes } from '@/data/types';
import { useFamily } from '@/features/family/useFamily';
import { VoiceField } from '@/features/voice/VoiceField';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Field, OptionChips, Screen, TopBar, palette, space } from '@/ui';

const RELATIONS = ['husband', 'mother', 'motherInLaw', 'sister', 'other'] as const;

/** FM-03 Add a family member (caregiver) with scopes the mother chooses (PRD F-05). */
export default function AddCaregiver() {
  const { t } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const [name, setName] = useState('');
  const [relation, setRelation] = useState<string>();
  const [phone, setPhone] = useState('');
  const [scopes, setScopes] = useState<CaregiverScopes>({ schedule: true, baby: true, logs: false });
  const valid = name.trim().length > 1 && !!relation && /^[6-9]\d{9}$/.test(phone);

  function save() {
    if (!ctx.mother || !valid) return;
    const rel = RELATIONS.find((r) => t(`family.me.rel.${r}`) === relation) ?? 'other';
    db.addCaregiver({ motherId: ctx.mother.id, name: name.trim(), relation: t(`family.me.rel.${rel}`, { lng: 'en' }), phone, scopes }, now);
    router.back();
  }

  return (
    <Screen blob="none" header={<TopBar back title={t('family.me.add')} />} footer={<Button label={t('family.me.save')} onPress={save} disabled={!valid} />}>
      <Card style={{ gap: space.md }}>
        <VoiceField label={t('family.me.name')} value={name} onChangeText={setName} />
        <OptionChips label={t('family.me.relation')} options={RELATIONS.map((r) => t(`family.me.rel.${r}`))} value={relation} onChange={setRelation} />
        <Field label={t('family.me.phone')} keyboardType="number-pad" maxLength={10} value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, ''))} />
      </Card>
      <Card style={{ gap: space.md }}>
        <AppText variant="headline">{t('family.me.canSee')}</AppText>
        {(Object.keys(scopes) as (keyof CaregiverScopes)[]).map((k) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <AppText variant="bodyMedium">{t(`family.me.scope.${k}`)}</AppText>
            <Switch value={scopes[k]} onValueChange={(v) => setScopes((s) => ({ ...s, [k]: v }))} trackColor={{ true: palette.rose300, false: palette.divider }} thumbColor={scopes[k] ? palette.rose500 : palette.white} />
          </View>
        ))}
        <AppText variant="caption" tone="faint">
          {t('family.me.never')}
        </AppText>
      </Card>
    </Screen>
  );
}
