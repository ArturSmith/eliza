import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { t, useLanguage } from './i18n';

export type Theme = 'light' | 'dark';
const key = 'eliza-theme';

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* Storage may be disabled. */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(key, theme); } catch { /* Keep the current theme in memory. */ }
}

export function ThemeSwitcher() {
  useLanguage();
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const next = theme === 'dark' ? 'light' : 'dark';
  return <button className="theme-switcher" type="button" aria-label={next === 'dark' ? t('Switch to dark theme') : t('Switch to light theme')}
    onClick={() => { applyTheme(next); setTheme(next); }}>
    {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    <span>{theme === 'dark' ? t('Light theme') : t('Dark theme')}</span>
  </button>;
}
