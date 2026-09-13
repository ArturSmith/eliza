import { useSyncExternalStore } from 'react';
import russian from './ru.json';

export type Language = 'en' | 'ru';
const storageKey = 'eliza.language';
const translations: Record<string, string> = russian;
function initialLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    /* Browser storage can be disabled. */
  }
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}
let language: Language = initialLanguage();
const listeners = new Set<() => void>();
function publish(next: Language) {
  language = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach((listener) => listener());
}
if (typeof window !== 'undefined') {
  document.documentElement.lang = language;
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey && (event.newValue === 'en' || event.newValue === 'ru'))
      publish(event.newValue);
  });
}
export function setLanguage(next: Language) {
  try {
    if (typeof window !== 'undefined') localStorage.setItem(storageKey, next);
  } catch {
    /* Keep the in-memory preference. */
  }
  publish(next);
}
export function useLanguage() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => language,
    () => 'en' as Language,
  );
}
export function getLocale() {
  return language === 'ru' ? 'ru-RU' : 'en-GB';
}
/** Translate interface text only; never pass product names or other store-entered data. */
export function t(key: string, values: Record<string, string | number> = {}): string {
  const translated =
    language === 'ru' ? key.replace(/\S(?:[\s\S]*\S)?/, (text) => translations[text] ?? text) : key;
  return translated.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}

/** API messages are translated at render time so a visible error follows the language. */
export function translateError(message: string): string {
  if (language === 'en') return message;
  if (translations[message]) return t(message);
  const stock = /^Not enough stock for (.+)\.$/.exec(message);
  if (stock) return t('Not enough stock for {name}.', { name: stock[1] });
  const whole = /^(.+) requires a whole-number quantity\.$/.exec(message);
  if (whole) return t('{name} requires a whole-number quantity.', { name: whole[1] });
  return message
    .split(/; |\. /)
    .map((part) => {
      if (translations[part]) return t(part);
      const small = /Too small: expected string to have >=(\d+) characters/.exec(part);
      const big = /Too big: expected string to have <=(\d+) characters/.exec(part);
      if (small)
        return part.replace(
          small[0],
          t('Too small: expected string to have >={min} characters', { min: small[1] }),
        );
      if (big)
        return part.replace(
          big[0],
          t('Too big: expected string to have <={max} characters', { max: big[1] }),
        );
      const separator = part.indexOf(': ');
      if (separator >= 0) return part.slice(0, separator + 2) + t(part.slice(separator + 2));
      return part;
    })
    .join('. ');
}

/** Count labels use Russian one/few/many forms while retaining English singular/plural. */
export function countText(kind: 'products' | 'suppliers' | 'orders' | 'counts', count: number) {
  const singular = { products: 'product', suppliers: 'supplier', orders: 'order', counts: 'count' };
  const english = count + ' ' + (count === 1 ? singular[kind] : kind);
  if (language === 'en') return english;
  const form = new Intl.PluralRules('ru-RU').select(count);
  return (translations[kind + '.' + form] ?? english).replace('{count}', String(count));
}
