import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';

// ── 统一 Y2K 复古电子 / 掌机像素风 Design Tokens ───────────
export const C = {
  bg: '#FFFDF2',
  card: '#FFFFFF',
  cardAlt: '#FAF7EC',
  pink: '#FF5E7C',
  purple: '#6C63FF',
  mint: '#2EC4B6',
  yellow: '#FFD166',
  red: '#FF3B30',
  orange: '#FF8C00',
  text: '#222222',
  textSub: '#555555',
  muted: '#8C887B',
  border: '#E8E2D2',
  borderDark: '#2D2A26',
  borderLight: '#F0EAE1',
  tagBg: '#F3EFE6',
};

// 统一复古电子卡片与按钮阴影
export const RETRO_SHADOW = [{ offsetX: 2.5, offsetY: 2.5, blurRadius: 0, color: '#2D2A26' }];
export const RETRO_SHADOW_SM = [{ offsetX: 1.5, offsetY: 1.5, blurRadius: 0, color: '#2D2A26' }];
export const RETRO_SHADOW_PINK = [{ offsetX: 2.5, offsetY: 2.5, blurRadius: 0, color: '#FF5E7C' }];
export const RETRO_SHADOW_PURPLE = [{ offsetX: 2.5, offsetY: 2.5, blurRadius: 0, color: '#6C63FF' }];

export const THEME = {
  light: {
    background: 'hsl(50 100% 98%)',
    foreground: 'hsl(0 0% 13%)',
    card: 'hsl(0 0% 100%)',
    cardForeground: 'hsl(0 0% 13%)',
    popover: 'hsl(0 0% 100%)',
    popoverForeground: 'hsl(0 0% 13%)',
    primary: 'hsl(345 100% 67%)',
    primaryForeground: 'hsl(0 0% 100%)',
    secondary: 'hsl(50 100% 70%)',
    secondaryForeground: 'hsl(0 0% 13%)',
    muted: 'hsl(50 40% 95%)',
    mutedForeground: 'hsl(50 10% 50%)',
    accent: 'hsl(247 100% 70%)',
    accentForeground: 'hsl(0 0% 100%)',
    destructive: 'hsl(348 100% 50%)',
    destructiveForeground: 'hsl(0 0% 100%)',
    border: 'hsl(50 30% 88%)',
    input: 'hsl(50 40% 95%)',
    ring: 'hsl(345 100% 67%)',
    radius: '1rem',
  },
  dark: {
    background: 'hsl(0 0% 13%)',
    foreground: 'hsl(50 100% 98%)',
    card: 'hsl(0 0% 18%)',
    cardForeground: 'hsl(50 100% 98%)',
    popover: 'hsl(0 0% 18%)',
    popoverForeground: 'hsl(50 100% 98%)',
    primary: 'hsl(345 100% 67%)',
    primaryForeground: 'hsl(0 0% 100%)',
    secondary: 'hsl(50 100% 70%)',
    secondaryForeground: 'hsl(0 0% 13%)',
    muted: 'hsl(0 0% 25%)',
    mutedForeground: 'hsl(50 20% 75%)',
    accent: 'hsl(247 100% 70%)',
    accentForeground: 'hsl(0 0% 100%)',
    destructive: 'hsl(348 100% 50%)',
    destructiveForeground: 'hsl(0 0% 100%)',
    border: 'hsl(0 0% 28%)',
    input: 'hsl(0 0% 25%)',
    ring: 'hsl(345 100% 67%)',
    radius: '1rem',
  },
};

export const NAV_THEME: Record<'light' | 'dark', Theme> = {
  light: {
    ...DefaultTheme,
    colors: {
      background: THEME.light.background,
      border: THEME.light.border,
      card: THEME.light.card,
      notification: THEME.light.destructive,
      primary: THEME.light.primary,
      text: THEME.light.foreground,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      background: THEME.dark.background,
      border: THEME.dark.border,
      card: THEME.dark.card,
      notification: THEME.dark.destructive,
      primary: THEME.dark.primary,
      text: THEME.dark.foreground,
    },
  },
};
