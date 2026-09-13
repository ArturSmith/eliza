import { Languages } from 'lucide-react';
import { setLanguage, t, useLanguage, type Language } from './index';

export function LanguageSwitcher() {
  const language = useLanguage();
  return (
    <div className="language-bar no-print">
      <label className="language-switcher">
        <Languages size={16} aria-hidden="true" />
        <span>{t('Language')}</span>
        <select
          aria-label={t('Language')}
          value={language}
          onChange={(event) => setLanguage(event.target.value as Language)}
        >
          <option value="en" lang="en">
            English
          </option>
          <option value="ru" lang="ru">
            Русский
          </option>
        </select>
      </label>
    </div>
  );
}
