import { Platform, TextStyle, ViewStyle } from 'react-native';

// Arrive Notify design system. Palette taken from the "Don't text. Just arrive." UI deck.
// Old key names (bg, card, ink, mute, line, route, routeSoft, danger) are kept so every
// screen keeps working; new keys are added for the redesign.
export const colors = {
  // surfaces
  bg: '#080D20',
  bgDeep: '#050816',
  surface: '#101A35',
  card: '#142044',
  cardHi: '#1A2A58',
  line: '#26386E',
  lineSoft: '#1B2850',

  // text
  ink: '#FFFFFF',
  mute: '#A7B3CC',
  dim: '#7684A6',

  // brand blues
  route: '#4778FF', // primary
  routeDeep: '#3558D6',
  routeSoft: '#17295A', // selected chips / soft fills
  accent: '#63A5FF',

  // states
  success: '#35D6A0',
  successSoft: '#0F3A3B',
  warning: '#F5B84B',
  warningSoft: '#3A2D12',
  danger: '#FF704F',
  emergency: '#FF704F',
  emergencySoft: '#2B1612',
  emergencyLine: '#6B2F22',

  onPrimary: '#FFFFFF',
};

export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

// Fixed control sizes so every button, input and icon matches across screens
export const size = { button: 52, buttonSm: 40, input: 52, icon: 20, iconSm: 16, iconLg: 24, tile: 44 } as const;

export const type = {
  display: { fontSize: 32, fontWeight: '800', letterSpacing: -0.8, color: colors.ink } as TextStyle,
  h1: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, color: colors.ink } as TextStyle,
  h2: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, color: colors.ink } as TextStyle,
  h3: { fontSize: 16, fontWeight: '700', color: colors.ink } as TextStyle,
  body: { fontSize: 14, fontWeight: '500', color: colors.ink } as TextStyle,
  small: { fontSize: 12, fontWeight: '500', color: colors.ink } as TextStyle,
  tag: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: colors.ink } as TextStyle,
};

// Small uppercase labels in the deck use a monospaced face
export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

export const glow = (color: string = colors.route): ViewStyle => ({
  shadowColor: color,
  shadowOpacity: 0.4,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 8,
});
