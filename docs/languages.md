# Interface languages

Eliza supports English and Russian. Use the language selector at the top of the app, including setup and checkout.

The initial language follows the browser (Russian for a Russian locale; English otherwise). An explicit choice is saved in this browser under `eliza.language` and synchronized across its tabs. If browser storage is disabled, the choice lasts for the current page session. Switching does not remount forms or clear carts.

Interface labels, units, statuses, receipt labels, common validation errors, and displayed dates/currency formatting follow the selected language. The store currency and timezone do not change. Product and supplier names, descriptions, categories, notes, and configured receipt text remain as entered. Imported product data is not machine-translated. Numeric API values retain their original representation.

## Maintaining translations

- English source strings are the translation keys, called explicitly with `t()` in React.
- Russian translations live in `apps/web/src/i18n/ru.json`.
- Subscribe with `useLanguage()` in components rendering translated text. Do not key a component by language: that would discard its state.
- Use named interpolation for dynamic values, and pass business data as values, not translation keys.
- Keep internal enum values, route paths, query keys, IDs, and saved data independent of language.
- Use `getLocale()` for display formatting; retain the store timezone. Machine-readable dates keep their existing format.
- Translate known server errors at render time with `translateError()`; unknown errors fall back to their original message.
- Run `pnpm exec vitest run tests/i18n.unit.test.ts` for catalog coverage and `pnpm exec playwright test tests/e2e/languages.spec.ts` for browser verification.
