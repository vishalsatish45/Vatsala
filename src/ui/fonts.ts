// Per-weight imports keep unused weights out of the bundle.
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
import { NotoSansDevanagari_400Regular } from '@expo-google-fonts/noto-sans-devanagari/400Regular';
import { NotoSansDevanagari_500Medium } from '@expo-google-fonts/noto-sans-devanagari/500Medium';
import { NotoSansDevanagari_600SemiBold } from '@expo-google-fonts/noto-sans-devanagari/600SemiBold';
import { NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari/700Bold';
import { NotoSansKannada_400Regular } from '@expo-google-fonts/noto-sans-kannada/400Regular';
import { NotoSansKannada_500Medium } from '@expo-google-fonts/noto-sans-kannada/500Medium';
import { NotoSansKannada_600SemiBold } from '@expo-google-fonts/noto-sans-kannada/600SemiBold';
import { NotoSansKannada_700Bold } from '@expo-google-fonts/noto-sans-kannada/700Bold';
import { NotoSerifDevanagari_400Regular } from '@expo-google-fonts/noto-serif-devanagari/400Regular';
import { NotoSerifKannada_400Regular } from '@expo-google-fonts/noto-serif-kannada/400Regular';

export const fontAssets = {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  InstrumentSerif_400Regular,
  NotoSansKannada_400Regular,
  NotoSansKannada_500Medium,
  NotoSansKannada_600SemiBold,
  NotoSansKannada_700Bold,
  NotoSerifKannada_400Regular,
  NotoSansDevanagari_400Regular,
  NotoSansDevanagari_500Medium,
  NotoSansDevanagari_600SemiBold,
  NotoSansDevanagari_700Bold,
  NotoSerifDevanagari_400Regular,
};

export type Script = 'latin' | 'kannada' | 'devanagari';

type FamilySet = { serif: string; regular: string; medium: string; semibold: string; bold: string };

export const families: Record<Script, FamilySet> = {
  latin: {
    serif: 'InstrumentSerif_400Regular',
    regular: 'DMSans_400Regular',
    medium: 'DMSans_500Medium',
    semibold: 'DMSans_600SemiBold',
    bold: 'DMSans_700Bold',
  },
  kannada: {
    serif: 'NotoSerifKannada_400Regular',
    regular: 'NotoSansKannada_400Regular',
    medium: 'NotoSansKannada_500Medium',
    semibold: 'NotoSansKannada_600SemiBold',
    bold: 'NotoSansKannada_700Bold',
  },
  devanagari: {
    serif: 'NotoSerifDevanagari_400Regular',
    regular: 'NotoSansDevanagari_400Regular',
    medium: 'NotoSansDevanagari_500Medium',
    semibold: 'NotoSansDevanagari_600SemiBold',
    bold: 'NotoSansDevanagari_700Bold',
  },
};

export function scriptForLanguage(lang: string): Script {
  if (lang.startsWith('kn')) return 'kannada';
  if (lang.startsWith('hi')) return 'devanagari';
  return 'latin';
}
