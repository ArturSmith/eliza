import { t, useLanguage, getLocale } from './i18n';
import { ReceiptSearch } from './refunds';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Receipt, Shift } from '@eliza/contracts';
import { api, useSession } from './api';
import { ErrorMessage } from './forms';
import { Dialog } from './components/ui/dialog';
import { Button } from './components/ui/button';
import { ReceiptView, formatMoney } from './receipts';
export function SalesPage() {
  useLanguage();
  const query = useQuery({ queryKey: ['sales'], queryFn: () => api<Receipt[]>('/reports/sales') });
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('CHECKOUT HISTORY')}</div>
          <h1>{t('Sales')}</h1>
          <p className="muted">
            {t(
              'Completed receipts with the original prices, tax, and payment details. Latest 100 sales. ',
            )}
          </p>
        </div>
      </div>
      <ReceiptSearch />
      <h2 style={{ marginTop: 24, marginBottom: 16 }}>{t('Recent receipts')}</h2>
      <ErrorMessage error={query.error} />
      <section className="panel">
        {query.isPending ? (
          <p className="panel-padding muted">{t('Loading sales…')}</p>
        ) : query.data?.length ? (
          <div className="table-scroll">
            <table aria-label={t('Recent receipts')}>
              <thead>
                <tr>
                  <th>{t('Receipt')}</th>
                  <th>{t('Cashier / register')}</th>
                  <th>{t('Payment')}</th>
                  <th>{t('Total')}</th>
                  <th>{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.receiptNumber}</strong>
                      <small>
                        {new Date(r.createdAt).toLocaleString(getLocale(), {
                          timeZone: r.timezone,
                        })}
                      </small>
                    </td>
                    <td>
                      {r.cashierName}
                      <small>{r.deviceName}</small>
                    </td>
                    <td>{r.payment.method === 'cash' ? t('Cash') : t('Card recorded')}</td>
                    <td>{formatMoney(r.total, r.currency)}</td>
                    <td>
                      <Button variant="ghost" onClick={() => setReceipt(r)}>
                        {t('View receipt ')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>{t('No sales yet')}</h3>
            <p className="muted">{t('Completed checkouts appear here automatically.')}</p>
          </div>
        )}
      </section>
      <Dialog
        open={!!receipt}
        onOpenChange={(v) => !v && setReceipt(null)}
        title={t('Sale receipt')}
        description={t('Historical sale details.')}
      >
        {receipt && (
          <ReceiptView
            receipt={receipt}
            reprint
            beforePrint={() => api(`/reports/sales/${receipt.id}/reprint`, {})}
          />
        )}
      </Dialog>
    </>
  );
}
export function ShiftsPage() {
  useLanguage();
  const session = useSession().data!;
  const query = useQuery({ queryKey: ['shifts'], queryFn: () => api<Shift[]>('/reports/shifts') });
  const [shift, setShift] = useState<Shift | null>(null);
  const cash = useQuery({
    queryKey: ['shift-cash', shift?.id],
    queryFn: () =>
      api<
        {
          id: string;
          amount: string;
          kind: string;
          reason: string;
          actor: string;
          createdAt: string;
        }[]
      >(`/reports/shifts/${shift!.id}/cash`),
    enabled: !!shift,
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('DRAWER ACCOUNTABILITY')}</div>
          <h1>{t('Shifts')}</h1>
          <p className="muted">
            {t('Opening float, expected cash, and counted totals. Latest 100 shifts. ')}
          </p>
        </div>
      </div>
      <ErrorMessage error={query.error} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{t('Drawer reconciliation')}</h2>
            <p className="muted">
              {t('Every shift with its expected, counted, and difference totals.')}
            </p>
          </div>
        </div>
        {query.isPending ? (
          <p className="panel-padding muted">{t('Loading shifts…')}</p>
        ) : query.data?.length ? (
          <div className="table-scroll">
            <table aria-label={t('Drawer reconciliation')}>
              <thead>
                <tr>
                  <th>{t('Cashier / register')}</th>
                  <th>{t('Opened')}</th>
                  <th>{t('Status')}</th>
                  <th>{t('Expected')}</th>
                  <th>{t('Counted')}</th>
                  <th>{t('Difference')}</th>
                  <th>{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.employeeName}</strong>
                      <small>{s.deviceName}</small>
                    </td>
                    <td>
                      {new Date(s.openedAt).toLocaleString(getLocale(), {
                        timeZone: session.store.timezone,
                      })}
                    </td>
                    <td>
                      <span className={`badge badge-${s.status === 'open' ? 'green' : 'gray'}`}>
                        {t(s.status)}
                      </span>
                    </td>
                    <td>{formatMoney(s.expectedCash, session.store.currency)}</td>
                    <td>
                      {s.countedCash === null
                        ? '—'
                        : formatMoney(s.countedCash, session.store.currency)}
                    </td>
                    <td className={s.difference && Number(s.difference) !== 0 ? 'negative' : ''}>
                      {s.difference === null
                        ? '—'
                        : formatMoney(s.difference, session.store.currency)}
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => setShift(s)}>
                        {t('Cash history ')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>{t('No shifts yet')}</h3>
            <p className="muted">{t('Start a shift from an enrolled register.')}</p>
          </div>
        )}
      </section>
      <Dialog
        open={!!shift}
        onOpenChange={(v) => !v && setShift(null)}
        title={t('Shift cash history')}
        description={
          shift
            ? t('{value0} · {value1}', { value0: shift.employeeName, value1: shift.deviceName })
            : t('Cash history')
        }
      >
        <ErrorMessage error={cash.error} />
        {cash.data?.map((c) => (
          <div className="cash-history-row" key={c.id}>
            <div>
              <strong>{c.reason}</strong>
              <small>
                {c.actor} ·{' '}
                {new Date(c.createdAt).toLocaleString(getLocale(), {
                  timeZone: session.store.timezone,
                })}
              </small>
            </div>
            <span>{formatMoney(c.amount, session.store.currency)}</span>
          </div>
        ))}
        {shift?.notes && <p className="notice">{shift.notes}</p>}
      </Dialog>
    </>
  );
}
