export type ThemeMode = 'dark' | 'light';

export interface ThemeConfig {
  syncToSystem: boolean;
  manualTheme: ThemeMode;
}

export const THEME_STORAGE_KEY = 'mediaforge_theme_config';

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  syncToSystem: false,
  manualTheme: 'dark',
};

export function resolveEffectiveTheme(
  config: ThemeConfig,
  systemPrefersDark: boolean
): ThemeMode {
  if (config.syncToSystem) {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return config.manualTheme;
}

export function loadThemeConfig(): ThemeConfig {
  if (typeof window === 'undefined') return DEFAULT_THEME_CONFIG;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ThemeConfig>;
    return {
      syncToSystem: Boolean(parsed.syncToSystem),
      manualTheme: parsed.manualTheme === 'light' ? 'light' : 'dark',
    };
  } catch {
    return DEFAULT_THEME_CONFIG;
  }
}

export function saveThemeConfig(config: ThemeConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota or sandbox restrictions
  }
}
