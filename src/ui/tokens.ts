import { Platform, type ViewStyle } from 'react-native';

/**
 * Design tokens — see DESIGN.md §3.
 * Atmosphere (gradient, glass, navbar) from inspiration A; components from inspiration B.
 */

export const palette = {
  // Atmosphere
  rose50: '#FDF1F6',
  rose100: '#F9DDE9',
  rose200: '#F6B8CF',
  rose300: '#EE9CBD',
  rose500: '#E0709A',
  rose600: '#C9557F',
  lav100: '#EEE8FB',
  lav200: '#D9CCF3',
  lav400: '#B9A6EE',
  lav600: '#7E68C9',
  // Neutrals
  cream: '#FBF7F2',
  beige: '#F1EBE3',
  hairline: '#EDE4DC',
  /** Dividers and outlines inside glass cards. */
  divider: 'rgba(110,90,103,0.12)',
  softBorder: 'rgba(201,85,127,0.14)',
  white: '#FFFFFF',
  ink: '#2E1F2A',
  inkSoft: '#6E5A67',
  inkFaint: '#A5949E',
  // Warm highlight (demoted orange from inspiration B)
  peach: '#F6B28A',
  amber: '#F28C38',
  // Operational status — task/visit status only, NEVER clinical values (PRD §2.2)
  done: '#4E9E78',
  due: '#D9962B',
  overdue: '#D6524B',
  info: '#7C6FE0',
} as const;

export type Mood = {
  bgGradient: readonly [string, string, string];
  blob: { color: string; opacity: number; radius: number };
  /** Glass fill as a top → bottom gradient: brighter at the top, pink shows through below (inspiration A). */
  glass: readonly [string, string];
  glassStrong: readonly [string, string];
  glassBorder: string;
  card: string;
  /** Row height for list rows — Care Team is denser. */
  rowMinHeight: number;
};

export const moods = {
  family: {
    bgGradient: ['#F9D3E1', '#F7E3EC', '#E2D9F5'],
    blob: { color: '#F0A9C6', opacity: 0.6, radius: 0.72 },
    glass: ['rgba(255,255,255,0.72)', 'rgba(255,255,255,0.36)'],
    glassStrong: ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0.62)'],
    glassBorder: 'rgba(255,255,255,0.85)',
    card: '#FFFFFF',
    rowMinHeight: 72,
  },
  care: {
    bgGradient: ['#FBEAF1', '#F7F1F6', '#EFEAFA'],
    blob: { color: '#F6C9DB', opacity: 0.6, radius: 0.55 },
    glass: ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0.70)'],
    glassStrong: ['rgba(255,255,255,0.97)', 'rgba(255,255,255,0.84)'],
    glassBorder: 'rgba(255,255,255,0.95)',
    card: '#FFFFFF',
    rowMinHeight: 64,
  },
} as const satisfies Record<string, Mood>;

export type MoodName = keyof typeof moods;

export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 12, md: 16, lg: 22, card: 28, sheet: 32, pill: 999 } as const;

// iOS uses classic shadow props. Android uses CSS-style boxShadow: `elevation` needs an
// opaque background to shape its shadow and bleeds through translucent/transparent views.
export const elevation = {
  card: Platform.select<ViewStyle>({
    ios: { shadowColor: palette.rose600, shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
    default: { boxShadow: '0px 4px 12px rgba(201, 85, 127, 0.08)' },
  }),
  float: Platform.select<ViewStyle>({
    ios: { shadowColor: palette.rose600, shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
    default: { boxShadow: '0px 8px 22px rgba(201, 85, 127, 0.14)' },
  }),
  glow: Platform.select<ViewStyle>({
    ios: { shadowColor: palette.rose500, shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
    default: { boxShadow: '0px 8px 24px rgba(224, 112, 154, 0.45)' },
  }),
};

/** Screen horizontal gutter. */
export const GUTTER = 20;
/** Space reserved under scroll content for the floating navbar. */
export const NAV_CLEARANCE = 116;

export type TaskStatus = 'done' | 'due' | 'overdue' | 'missed' | 'upcoming';

export const statusColor: Record<TaskStatus, string> = {
  done: palette.done,
  due: palette.due,
  overdue: palette.overdue,
  missed: palette.overdue,
  upcoming: palette.inkFaint,
};
