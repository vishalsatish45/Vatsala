import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { families, scriptForLanguage } from './fonts';
import { palette } from './tokens';

type Weight = 'serif' | 'regular' | 'medium' | 'semibold' | 'bold';

// DESIGN.md §3.2
const variants = {
  display: { size: 34, line: 40, weight: 'serif' },
  title: { size: 24, line: 30, weight: 'serif' },
  hero: { size: 64, line: 70, weight: 'bold', letterSpacing: -1.5, numeric: true },
  stat: { size: 32, line: 38, weight: 'bold', letterSpacing: -0.5, numeric: true },
  tile: { size: 48, line: 54, weight: 'bold', letterSpacing: -1.5, numeric: true },
  headline: { size: 17, line: 22, weight: 'semibold' },
  body: { size: 15, line: 22, weight: 'regular' },
  bodyMedium: { size: 15, line: 22, weight: 'medium' },
  label: { size: 13, line: 18, weight: 'medium' },
  caption: { size: 12, line: 16, weight: 'regular' },
} satisfies Record<string, { size: number; line: number; weight: Weight; letterSpacing?: number; numeric?: boolean }>;

export type TextVariant = keyof typeof variants;

const tones = {
  primary: palette.ink,
  secondary: palette.inkSoft,
  faint: palette.inkFaint,
  onPrimary: palette.white,
  accent: palette.rose600,
  done: palette.done,
  due: palette.due,
  overdue: palette.overdue,
} as const;

export type TextTone = keyof typeof tones;

export type AppTextProps = TextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
};

/**
 * All text goes through here so the right script font (Latin / Kannada / Devanagari)
 * and line height are applied automatically. Numbers (hero, stat) always use DM Sans.
 */
export function AppText({ variant = 'body', tone = 'primary', align, style, ...rest }: AppTextProps) {
  const { i18n } = useTranslation();
  const v: (typeof variants)[TextVariant] = variants[variant];
  const numeric = 'numeric' in v && v.numeric;
  const script = numeric ? 'latin' : scriptForLanguage(i18n.language);
  const indic = script !== 'latin';

  return (
    <Text
      maxFontSizeMultiplier={1.3}
      style={[
        {
          fontFamily: families[script][v.weight],
          fontSize: indic && v.weight === 'serif' ? v.size * 0.82 : v.size,
          lineHeight: indic ? Math.round(v.line * 1.2) : v.line,
          letterSpacing: 'letterSpacing' in v ? v.letterSpacing : undefined,
          color: tones[tone],
          textAlign: align,
          fontVariant: numeric ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
      {...rest}
    />
  );
}
