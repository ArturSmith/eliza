import { useState } from 'react';
import { ErrorMessage } from './forms';
import type { Receipt } from '@eliza/contracts';
import { Printer, CheckCircle2 } from 'lucide-react';
import { Button } from './components/ui/button';
export function formatMoney(value: string, currency = 'NOK') {
  const [whole, fraction = ''] = value.split('.');
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency })
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
            {reprint ? 'REPRINT · ' : ''}
            {receipt.receiptNumber}
          </p>
          <small>
            {new Date(receipt.createdAt).toLocaleString('en-GB', { timeZone: receipt.timezone })}
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
                {l.quantity} {l.unit} × {formatMoney(l.price, receipt.currency)} · tax{' '}
                {Number(l.taxRate)}%
              </small>
              {Number(l.discount) > 0 && (
                <small>Discount −{formatMoney(l.discount, receipt.currency)}</small>
              )}
            </div>
            <strong>{formatMoney(l.total, receipt.currency)}</strong>
          </div>
        ))}
        <dl className="receipt-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatMoney(receipt.subtotal, receipt.currency)}</dd>
          </div>
          <div>
            <dt>Discount ({Number(receipt.discountPercent)}%)</dt>
            <dd>−{formatMoney(receipt.discount, receipt.currency)}</dd>
          </div>
          <div>
            <dt>Included tax</dt>
            <dd>{formatMoney(receipt.tax, receipt.currency)}</dd>
          </div>
          <div className="receipt-grand">
            <dt>Total</dt>
            <dd>{formatMoney(receipt.total, receipt.currency)}</dd>
          </div>
          <div>
            <dt>{receipt.payment.method === 'cash' ? 'Cash tendered' : 'Card recorded'}</dt>
            <dd>{formatMoney(receipt.payment.tendered, receipt.currency)}</dd>
          </div>
          {receipt.payment.method === 'cash' && (
            <div>
              <dt>Change</dt>
              <dd>{formatMoney(receipt.payment.change, receipt.currency)}</dd>
            </div>
          )}
        </dl>
        {receipt.approverName && <p className="muted">Approved by {receipt.approverName}</p>}
        <p className="receipt-thanks" style={{ whiteSpace: 'pre-wrap' }}>
          {receipt.receiptFooter ?? 'Thank you for shopping with us.'}
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
        Print receipt
      </Button>
    </div>
  );
}
