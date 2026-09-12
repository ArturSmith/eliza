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
  const query = useQuery({ queryKey: ['sales'], queryFn: () => api<Receipt[]>('/reports/sales') });
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CHECKOUT HISTORY</div>
          <h1>Sales</h1>
          <p className="muted">
            Completed receipts with the original prices, tax, and payment details. Latest 100 sales.
          </p>
        </div>
      </div>
      <ReceiptSearch />
      <h2 style={{ marginTop: 24, marginBottom: 16 }}>Recent receipts</h2>
      <ErrorMessage error={query.error} />
      <section className="panel">
        {query.isPending ? (
          <p className="panel-padding muted">Loading sales…</p>
        ) : query.data?.length ? (
          <div className="table-scroll">
            <table aria-label="Recent receipts">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Cashier / register</th>
                  <th>Payment</th>
                  <th>Total</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.receiptNumber}</strong>
                      <small>
                        {new Date(r.createdAt).toLocaleString('en-GB', { timeZone: r.timezone })}
                      </small>
                    </td>
                    <td>
                      {r.cashierName}
                      <small>{r.deviceName}</small>
                    </td>
                    <td>{r.payment.method === 'cash' ? 'Cash' : 'Card recorded'}</td>
                    <td>{formatMoney(r.total, r.currency)}</td>
                    <td>
                      <Button variant="ghost" onClick={() => setReceipt(r)}>
                        View receipt
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>No sales yet</h3>
            <p className="muted">Completed checkouts appear here automatically.</p>
          </div>
        )}
      </section>
      <Dialog
        open={!!receipt}
        onOpenChange={(v) => !v && setReceipt(null)}
        title="Sale receipt"
        description="Historical sale details."
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
          <div className="eyebrow">DRAWER ACCOUNTABILITY</div>
          <h1>Shifts</h1>
          <p className="muted">
            Opening float, expected cash, and counted totals. Latest 100 shifts.
          </p>
        </div>
      </div>
      <h2>Drawer reconciliation</h2>
      <ErrorMessage error={query.error} />
      <section className="panel">
        {query.isPending ? (
          <p className="panel-padding muted">Loading shifts…</p>
        ) : query.data?.length ? (
          <div className="table-scroll">
            <table aria-label="Drawer reconciliation">
              <thead>
                <tr>
                  <th>Cashier / register</th>
                  <th>Opened</th>
                  <th>Status</th>
                  <th>Expected</th>
                  <th>Counted</th>
                  <th>Difference</th>
                  <th>Actions</th>
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
                      {new Date(s.openedAt).toLocaleString('en-GB', {
                        timeZone: session.store.timezone,
                      })}
                    </td>
                    <td>
                      <span className={`badge badge-${s.status === 'open' ? 'green' : 'gray'}`}>
                        {s.status}
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
                        Cash history
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>No shifts yet</h3>
            <p className="muted">Start a shift from an enrolled register.</p>
          </div>
        )}
      </section>
      <Dialog
        open={!!shift}
        onOpenChange={(v) => !v && setShift(null)}
        title="Shift cash history"
        description={shift ? `${shift.employeeName} · ${shift.deviceName}` : 'Cash history'}
      >
        <ErrorMessage error={cash.error} />
        {cash.data?.map((c) => (
          <div className="cash-history-row" key={c.id}>
            <div>
              <strong>{c.reason}</strong>
              <small>
                {c.actor} ·{' '}
                {new Date(c.createdAt).toLocaleString('en-GB', {
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
