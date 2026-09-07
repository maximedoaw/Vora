/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/**
 * Palette Vora — un jeton par usage, décliné en clair et en sombre.
 * Le vert de marque ne change pas : c'est le seul point fixe des deux thèmes.
 */
export const VoraColors = {
  light: {
    background: '#f4f5f7',
    surface: 'rgba(255,255,255,0.97)',
    surfaceAlt: '#ffffff',
    surfaceMuted: '#f0f1f4',
    surfaceStrong: '#e8e9ee',
    border: '#dcdde3',
    borderStrong: '#c6c8d0',
    divider: '#e6e7ec',
    text: '#111315',
    textSecondary: '#5c6169',
    textMuted: '#8a8f97',
    placeholder: '#9ba0a8',
    accent: '#12b356',
    accentSoft: 'rgba(18,179,86,0.10)',
    accentBorder: 'rgba(18,179,86,0.35)',
    onAccent: '#ffffff',
    bubbleMineText: '#ffffff',
    bubbleMineTime: 'rgba(255,255,255,0.7)',
    warning: '#8a5a00',
    warningBg: 'rgba(255,176,32,0.14)',
    warningBorder: 'rgba(255,176,32,0.45)',
    danger: '#b3261e',
    dangerBg: 'rgba(179,38,30,0.08)',
    dangerBorder: 'rgba(179,38,30,0.35)',
    mapBackground: '#e9eaee',
    scrim: 'rgba(0,0,0,0.06)',
    /** Or des étoiles de notation : identique dans les deux thèmes. */
    star: '#F5B301',
    starEmpty: '#c9ccd3',
  },
  dark: {
    background: '#000000',
    surface: 'rgba(18,18,18,0.96)',
    surfaceAlt: '#121212',
    surfaceMuted: '#1a1a1a',
    surfaceStrong: '#1f1f1f',
    border: '#2a2a2a',
    borderStrong: '#3a3a3a',
    divider: '#242424',
    text: '#ffffff',
    textSecondary: '#9a9a9a',
    textMuted: '#7a7a7a',
    placeholder: '#7a7a7a',
    accent: '#1ED760',
    accentSoft: 'rgba(30,215,96,0.12)',
    accentBorder: 'rgba(30,215,96,0.40)',
    onAccent: '#08210f',
    bubbleMineText: '#08210f',
    bubbleMineTime: 'rgba(8,33,15,0.6)',
    warning: '#ffc65c',
    warningBg: 'rgba(255,176,32,0.12)',
    warningBorder: 'rgba(255,176,32,0.35)',
    danger: '#ffb4b4',
    dangerBg: 'rgba(40,12,12,0.94)',
    dangerBorder: 'rgba(255,79,79,0.45)',
    mapBackground: '#111111',
    scrim: 'rgba(0,0,0,0.35)',
    star: '#F5B301',
    starEmpty: '#3a3a3a',
  },
} as const;

export type ColorScheme = keyof typeof VoraColors;
/** Les valeurs sont figées par `as const` : on élargit en `string` pour que les
 *  deux thèmes partagent bien un seul et même type. */
export type VoraPalette = { [K in keyof (typeof VoraColors)['light']]: string };
