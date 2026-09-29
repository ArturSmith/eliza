import { t, useLanguage, getLocale } from './i18n';
import { useState } from 'react';
import { ErrorMessage } from './forms';
import type { Receipt } from '@eliza/contracts';
import { Printer, CheckCircle2 } from 'lucide-react';
import { Button } from './components/ui/button';
export function formatMoney(value: string, currency = 'NOK') {
  const [whole, fraction = ''] = value.split('.');
  return new Intl.NumberFormat(getLocale(), { style: 'currency', currency })
    .formatToParts(value.startsWith('-') && BigInt(whole) === 0n ? -0 : BigInt(whole))
    .map((part) => (part.type === 'fraction' ? fraction.padEnd(2, '0').slice(0, 2) : part.value))
    .join('');
}
export function ReceiptView({
  receipt,
  reprint = false,
  beforePrint,
}: {
  receipt: Receipt;
  reprint?: boolean;
  beforePrint?: () => Promise<unknown>;
}) {
  useLanguage();
  const [error, setError] = useState<unknown>(null);
  const [printing, setPrinting] = useState(false);
  async function print() {
    setPrinting(true);
    setError(null);
    try {
      await beforePrint?.();
      window.print();
    } catch (e) {
      setError(e);
    } finally {
      setPrinting(false);
    }
  }
  return (
    <div className="receipt-wrap">
      <article className="receipt">
        <div className="receipt-top">
          <CheckCircle2 size={30} />
          <h2>{receipt.storeName}</h2>
          {receipt.storeAddress && <p style={{ whiteSpace: 'pre-wrap' }}>{receipt.storeAddress}</p>}
          {receipt.storePhone && <p>{receipt.storePhone}</p>}
          {receipt.businessNumber && <p>{receipt.businessNumber}</p>}
          <p>
            {reprint ? t('REPRINT · ') : ''}
            {receipt.receiptNumber}
          </p>
          <small>
            {new Date(receipt.createdAt).toLocaleString(getLocale(), {
              timeZone: receipt.timezone,
            })}
          </small>
        </div>
        <div className="receipt-meta">
          <span>{receipt.deviceName}</span>
          <span>{receipt.cashierName}</span>
        </div>
        {receipt.lines.map((l) => (
          <div className="receipt-line" key={l.productId}>
            <div>
              <strong>{l.name}</strong>
              <small>
                {l.quantity} {t(l.unit ?? '')} × {formatMoney(l.price, receipt.currency)}{' '}
                {t(' · tax')} {Number(l.taxRate)}%
              </small>
              {Number(l.discount) > 0 && (
                <small>
                  {t('Discount −')}
                  {formatMoney(l.discount, receipt.currency)}
                </small>
              )}
            </div>
            <strong>{formatMoney(l.total, receipt.currency)}</strong>
          </div>
        ))}
        <dl className="receipt-totals">
          <div>
            <dt>{t('Subtotal')}</dt>
            <dd>{formatMoney(receipt.subtotal, receipt.currency)}</dd>
          </div>
          {Number(receipt.discount) > 0 && (
            <div>
              <dt>
                {Number(receipt.discountPercent) > 0
                  ? `${t('Discount (')}${Number(receipt.discountPercent)}%)`
                  : t('Discount')}
              </dt>
              <dd>−{formatMoney(receipt.discount, receipt.currency)}</dd>
            </div>
          )}
          <div>
            <dt>{t('Included tax')}</dt>
            <dd>{formatMoney(receipt.tax, receipt.currency)}</dd>
          </div>
          <div className="receipt-grand">
            <dt>{t('Total')}</dt>
            <dd>{formatMoney(receipt.total, receipt.currency)}</dd>
          </div>
          <div>
            <dt>{receipt.payment.method === 'cash' ? t('Cash tendered') : t('Card recorded')}</dt>
            <dd>{formatMoney(receipt.payment.tendered, receipt.currency)}</dd>
          </div>
          {receipt.payment.method === 'cash' && (
            <div>
              <dt>{t('Change')}</dt>
              <dd>{formatMoney(receipt.payment.change, receipt.currency)}</dd>
            </div>
          )}
        </dl>
        {receipt.approverName && (
          <p className="muted">
            {t('Approved by ')}
            {receipt.approverName}
          </p>
        )}
        <p className="receipt-thanks" style={{ whiteSpace: 'pre-wrap' }}>
          {receipt.receiptFooter ?? t('Thank you for shopping with us.')}
        </p>
      </article>
      <ErrorMessage error={error} />
      <Button
        variant="outline"
        className="full no-print"
        disabled={printing}
        onClick={() => void print()}
      >
        <Printer size={16} />
        {t('Print receipt ')}
      </Button>
    </div>
  );
}
