export interface Theme {
  id: string;
  name: string;
  isDark: boolean;
  colors: {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
    950: string;
  };
  bg: string;
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  buttonPrimary: string;
  buttonSecondary: string;
  accent: string;
  shadow: string;
}

const LIGHT_THEME: Theme = {
  id: 'light',
  name: '极简中性',
  isDark: false,
  colors: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
    950: '#030712',
  },
  bg: '#f9fafb',
  cardBg: '#ffffff',
  cardBorder: '#e5e7eb',
  textPrimary: '#1f2937',
  textSecondary: '#6b7280',
  buttonPrimary: '#111827',
  buttonSecondary: '#f3f4f6',
  accent: '#2563eb',
  shadow: '0 1px 3px 0 rgb(0 0 0 / 0.05)',
};

const DARK_THEME: Theme = {
  id: 'dark',
  name: '深夜模式',
  isDark: true,
  colors: {
    50: '#18181b',
    100: '#27272a',
    200: '#3f3f46',
    300: '#52525b',
    400: '#71717a',
    500: '#a1a1aa',
    600: '#d4d4d8',
    700: '#e4e4e7',
    800: '#f4f4f5',
    900: '#fafafa',
    950: '#ffffff',
  },
  bg: '#09090b',
  cardBg: '#18181b',
  cardBorder: '#27272a',
  textPrimary: '#fafafa',
  textSecondary: '#a1a1aa',
  buttonPrimary: '#fafafa',
  buttonSecondary: '#27272a',
  accent: '#3b82f6',
  shadow: '0 1px 3px 0 rgb(0 0 0 / 0.3)',
};

export const themes: Record<string, Theme> = {
  light: LIGHT_THEME,
  dark: DARK_THEME,
};

export const DEFAULT_THEME = 'light';

export function getCurrentTheme(): Theme {
  if (typeof window === 'undefined') return themes[DEFAULT_THEME];
  const saved = localStorage.getItem('theme');
  return themes[saved || DEFAULT_THEME] || themes[DEFAULT_THEME];
}

export function setCurrentTheme(themeId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('theme', themeId);
  applyTheme(themeId);
}

export function applyTheme(themeId: string): void {
  const theme = themes[themeId];
  if (!theme) return;

  const root = document.documentElement;

  root.style.setProperty('--brand-50', theme.colors[50]);
  root.style.setProperty('--brand-100', theme.colors[100]);
  root.style.setProperty('--brand-200', theme.colors[200]);
  root.style.setProperty('--brand-300', theme.colors[300]);
  root.style.setProperty('--brand-400', theme.colors[400]);
  root.style.setProperty('--brand-500', theme.colors[500]);
  root.style.setProperty('--brand-600', theme.colors[600]);
  root.style.setProperty('--brand-700', theme.colors[700]);
  root.style.setProperty('--brand-800', theme.colors[800]);
  root.style.setProperty('--brand-900', theme.colors[900]);
  root.style.setProperty('--brand-950', theme.colors[950]);

  if (theme.bg) root.style.setProperty('--theme-bg', theme.bg);
  if (theme.cardBg) root.style.setProperty('--theme-card-bg', theme.cardBg);
  if (theme.cardBorder) root.style.setProperty('--theme-card-border', theme.cardBorder);
  if (theme.textPrimary) root.style.setProperty('--theme-text-primary', theme.textPrimary);
  if (theme.textSecondary) root.style.setProperty('--theme-text-secondary', theme.textSecondary);
  if (theme.buttonPrimary) root.style.setProperty('--theme-button-primary', theme.buttonPrimary);
  if (theme.buttonSecondary) root.style.setProperty('--theme-button-secondary', theme.buttonSecondary);
  if (theme.accent) root.style.setProperty('--theme-accent', theme.accent);
  if (theme.shadow) root.style.setProperty('--theme-shadow', theme.shadow);

  root.classList.remove('theme-light', 'theme-dark', 'theme-professional', 'theme-fresh', 'theme-tech');
  root.classList.add(`theme-${themeId}`);

  if (theme.isDark) {
    root.classList.add('dark-mode');
  } else {
    root.classList.remove('dark-mode');
  }
}

export function initTheme(): void {
  const currentTheme = getCurrentTheme();
  applyTheme(currentTheme.id);
}

export function getThemeList(): { id: string; name: string }[] {
  return Object.values(themes).map(t => ({ id: t.id, name: t.name }));
}
