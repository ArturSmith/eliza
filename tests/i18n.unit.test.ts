import { afterEach, describe, expect, it } from 'vitest';
import { countText, getLocale, setLanguage, t, translateError } from '../apps/web/src/i18n';
import russian from '../apps/web/src/i18n/ru.json';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

afterEach(() => setLanguage('en'));
describe('English and Russian interface', () => {
  it('translates labels and preserves interpolated business data and spacing', () => {
    setLanguage('ru');
    expect(t(' Products ')).toBe(' Товары ');
    expect(t('Edit {value0}', { value0: 'Cash' })).toBe('Изменить: Cash');
    expect(t('Unknown future label')).toBe('Unknown future label');
    expect(getLocale()).toBe('ru-RU');
    setLanguage('en');
    expect(t('Products')).toBe('Products');
    expect(getLocale()).toBe('en-GB');
  });
  it('uses Russian singular, few, and many count forms', () => {
    setLanguage('ru');
    expect(countText('products', 1)).toBe('1 товар');
    expect(countText('products', 2)).toBe('2 товара');
    expect(countText('products', 5)).toBe('5 товаров');
    expect(countText('products', 21)).toBe('21 товар');
    setLanguage('en');
    expect(countText('products', 1)).toBe('1 product');
    expect(countText('products', 2)).toBe('2 products');
  });
  it('translates errors without translating product names', () => {
    setLanguage('ru');
    expect(translateError('Email or password is incorrect.')).toBe('Неверная почта или пароль.');
    expect(translateError('Not enough stock for Cash.')).toBe('Недостаточно товара: Cash.');
    expect(
      translateError('password: Too small: expected string to have >=12 characters'),
    ).toContain('Нужно не менее 12 символов');
  });
  it('has a Russian entry for every static interface translation key', () => {
    const missing = new Set<string>();
    function walk(directory: string) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(file);
          continue;
        }
        if (!/\.tsx?$/.test(file)) continue;
        const source = ts.createSourceFile(
          file,
          fs.readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        function visit(node: ts.Node) {
          if (
            ts.isCallExpression(node) &&
            node.expression.getText(source) === 't' &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
          ) {
            const key = node.arguments[0].text.trim();
            if (/[a-zA-Z]/.test(key) && !(key in russian)) missing.add(key);
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
    walk('apps/web/src');
    expect([...missing].sort()).toEqual([]);
  });
});
