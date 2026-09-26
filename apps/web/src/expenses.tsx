import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { expenseSchema, type Expense, type ExpenseInput } from '@eliza/contracts';
import { api, queryClient, useSession } from './api';
import { Field, ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { t, useLanguage, getLocale } from './i18n';
import './expenses.css';
const categories = [
  'Rent',
  'Utilities',
  'Salaries',
  'Transport',
  'Repairs',
  'Supplies',
  'Marketing',
  'Other',
];
function localDate(timezone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function ExpensesPage() {
  useLanguage();
  const session = useSession();
  const today = localDate(session.data?.store.timezone ?? 'UTC');
  const [from, setFrom] = useState(today.slice(0, 7) + '-01'),
    [to, setTo] = useState(today),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null),
    [deleting, setDeleting] = useState<Expense | null>(null);
  const canManage = session.data?.user.permissions.includes('expenses.manage');
  const currency = session.data?.store.currency ?? 'NOK';
  const money = (amount: string) =>
    new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(Number(amount));
  const list = useQuery({
    queryKey: ['expenses', from, to, search, page],
    queryFn: () =>
      api<{ rows: Expense[]; count: number; total: string }>(
        `/expenses?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), search, page: String(page) })}`,
      ),
  });
  const remove = useMutation({
    mutationFn: (expense: Expense) =>
      api(`/expenses/${expense.id}`, { version: expense.version }, 'DELETE'),
    onSuccess: () => {
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('SHOP COSTS')}</div>
          <h1>{t('Expenses')}</h1>
          <p className="muted">
            {t('Record operating costs and review where your shop spends money.')}
          </p>
        </div>
        {canManage && <Button onClick={() => setEditing('new')}>{t('Add expense')}</Button>}
      </div>
      <section className="panel panel-padding expenses-filters">
        <Field label={t('From')}>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label={t('To')}>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label={t('Search expenses')}>
          <input
            value={search}
            placeholder={t('Description, category, payee or reference')}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
      </section>
      <ErrorMessage error={list.error} />
      <div className="expenses-summary">
        <div>
          <span className="muted">{t('Total expenses in selected period')}</span>
          <strong>{money(list.data?.total ?? '0')}</strong>
        </div>
        <div>
          <span className="muted">{t('Entries')}</span>
          <strong>{list.data?.count ?? 0}</strong>
        </div>
      </div>
      <p className="muted expenses-note">
        {t('Expense records do not change register cash or purchase payments.')}
      </p>
      <section className="panel expenses-table">
        <table>
          <thead>
            <tr>
              {['Date', 'Description', 'Category', 'Payment method', 'Amount', 'Actions'].map(
                (label) => (
                  <th key={label}>{t(label)}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {list.data?.rows.map((expense) => (
              <tr key={expense.id}>
                <td>
                  {new Intl.DateTimeFormat(getLocale()).format(
                    new Date(expense.date + 'T12:00:00'),
                  )}
                </td>
                <td>
                  <strong>{expense.description}</strong>
                  {expense.payee && <small>{expense.payee}</small>}
                  {expense.reference && <small>{expense.reference}</small>}
                  {expense.notes && <small>{expense.notes}</small>}
                </td>
                <td>{t(expense.category)}</td>
                <td>
                  {t(
                    { cash: 'Cash', card: 'Card', bank: 'Bank transfer', other: 'Other' }[
                      expense.paymentMethod
                    ],
                  )}
                </td>
                <td className="expenses-amount">{money(expense.amount)}</td>
                <td>
                  {canManage && (
                    <div className="expenses-actions">
                      <Button variant="outline" onClick={() => setEditing(expense)}>
                        {t('Edit')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          remove.reset();
                          setDeleting(expense);
                        }}
                      >
                        {t('Delete')}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.isPending ? (
          <p className="panel-padding">{t('Loading…')}</p>
        ) : !list.error && !list.data?.rows.length ? (
          <p className="panel-padding">{t('No expenses in this period.')}</p>
        ) : null}
      </section>
      <div className="expenses-pagination">
        <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          {t('Previous')}
        </Button>
        <span>
          {page} / {Math.max(1, Math.ceil((list.data?.count ?? 0) / 50))}
        </span>
        <Button
          variant="outline"
          disabled={page * 50 >= (list.data?.count ?? 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          {t('Next')}
        </Button>
      </div>
      {editing && (
        <ExpenseForm
          expense={editing === 'new' ? null : editing}
          today={today}
          currency={currency}
          done={() => setEditing(null)}
        />
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
        title={t('Delete expense?')}
        description={t(
          'The entry will be removed from expenses. Its changes remain in the activity log.',
        )}
      >
        <p>
          {deleting?.description} · {money(deleting?.amount ?? '0')}
        </p>
        <ErrorMessage error={remove.error} />
        <div className="expenses-actions">
          <Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(null)}>
            {t('Cancel')}
          </Button>
          <Button disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
            {t('Delete')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
function ExpenseForm({
  expense,
  today,
  currency,
  done,
}: {
  expense: Expense | null;
  today: string;
  currency: string;
  done: () => void;
}) {
  const [value, setValue] = useState<ExpenseInput>(
    expense ?? {
      date: today,
      description: '',
      category: 'Other',
      amount: '',
      paymentMethod: 'cash',
      payee: '',
      reference: '',
      notes: '',
    },
  );
  const [error, setError] = useState<unknown>();
  const save = useMutation({
    mutationFn: (body: ExpenseInput) =>
      expense
        ? api(`/expenses/${expense.id}`, { ...body, version: expense.version }, 'PATCH')
        : api('/expenses', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      done();
    },
  });
  const update = (key: keyof ExpenseInput, text: string) =>
    setValue((before) => ({ ...before, [key]: text }));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) done();
      }}
      title={t(expense ? 'Edit expense' : 'Add expense')}
      description={t('Enter the total paid in the shop currency.')}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const result = expenseSchema.safeParse({
            ...value,
            amount: value.amount.replace(',', '.'),
          });
          if (!result.success) {
            setError(result.error.issues.map((i) => i.message).join('. '));
            return;
          }
          setError(null);
          save.mutate(result.data);
        }}
      >
        <fieldset disabled={save.isPending} className="expenses-form">
          <div className="form-grid">
            <Field label={t('Date')}>
              <input
                required
                type="date"
                value={value.date}
                onChange={(e) => update('date', e.target.value)}
              />
            </Field>
            <Field label={`${t('Amount')} (${currency})`}>
              <input
                required
                inputMode="decimal"
                value={value.amount}
                onChange={(e) => update('amount', e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('Description')}>
            <input
              required
              maxLength={200}
              value={value.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field label={t('Category')}>
              <select value={value.category} onChange={(e) => update('category', e.target.value)}>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {t(category)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Payment method')}>
              <select
                value={value.paymentMethod}
                onChange={(e) => update('paymentMethod', e.target.value)}
              >
                {(['cash', 'card', 'bank', 'other'] as const).map((method) => (
                  <option key={method} value={method}>
                    {t(
                      { cash: 'Cash', card: 'Card', bank: 'Bank transfer', other: 'Other' }[method],
                    )}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('Payee (optional)')}>
            <input
              maxLength={200}
              value={value.payee}
              onChange={(e) => update('payee', e.target.value)}
            />
          </Field>
          <Field label={t('Reference (optional)')}>
            <input
              maxLength={200}
              value={value.reference}
              onChange={(e) => update('reference', e.target.value)}
            />
          </Field>
          <Field label={t('Notes (optional)')}>
            <textarea
              rows={3}
              maxLength={2000}
              value={value.notes}
              onChange={(e) => update('notes', e.target.value)}
            />
          </Field>
          <ErrorMessage error={error ?? save.error} />
          <Button disabled={save.isPending}>
            {t(save.isPending ? 'Saving…' : 'Save expense')}
          </Button>
        </fieldset>
      </form>
    </Dialog>
  );
}
