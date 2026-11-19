import type { ReactNode } from 'react';
import { Field } from './forms';
import { formatMoney } from './receipts';
import { t, useLanguage } from './i18n';

/** Both environments ask for the same physical count and optional closing notes. */
export function ShiftCloseFields({
  expectedCash,
  currency,
  counted,
  onCounted,
  approval,
  management = false,
}: {
  expectedCash: string;
  currency: string;
  counted: string;
  onCounted: (value: string) => void;
  approval?: ReactNode;
  management?: boolean;
}) {
  useLanguage();
  return (
    <>
      <p className="notice">
        {t('Expected drawer cash:')} <strong>{formatMoney(expectedCash, currency)}</strong>
      </p>
      <Field label={t('Counted cash')}>
        <input
          name="countedCash"
          inputMode="decimal"
          value={counted}
          onChange={(e) => onCounted(e.target.value)}
          required
          autoFocus={management}
        />
      </Field>
      <Field label={t('Closing notes')}>
        <textarea name="notes" maxLength={500} rows={2} />
      </Field>
      {approval}
      <p className="muted">
        {t(
          management
            ? 'Closing makes this shift’s totals permanent. The register must start a new shift before taking more sales.'
            : 'Closing makes this shift’s totals permanent. Finish or hold your cart before closing. ',
        )}
      </p>
    </>
  );
}
