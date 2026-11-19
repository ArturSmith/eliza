import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { storeToday } from '@eliza/contracts';
import { api, useSession } from './api';
import { Field, ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { formatQuantity } from './quantity-format';
import { t, useLanguage, getLocale } from './i18n';
type Member = {
  id: string;
  joinedAt: string;
  currentBalance: string;
  periodEndBalance: string;
  used: string;
  restored: string;
  spent: string;
};
type Report = {
  total: number;
  page: number;
  pageSize: number;
  members: Member[];
  totals: {
    currentBalance: string;
    periodEndBalance: string;
    used: string;
    restored: string;
    spent: string;
    availableBalance: string;
    negativeBalance: string;
  };
  period: { from: string; to: string; timezone: string };
};
export function LoyaltyMembers() {
  useLanguage();
  const store = useSession().data!.store;
  const today = storeToday(new Date(), store.timezone);
  const [draft, setDraft] = useState({ from: today.slice(0, 7) + '-01', to: today });
  const [period, setPeriod] = useState(draft),
    [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['loyalty-members', store.id, period, page],
    queryFn: () =>
      api<Report>('/loyalty/members?' + new URLSearchParams({ ...period, page: String(page) })),
    refetchInterval: 60000,
  });
  const r = q.data;
  return (
    <section className="card loyalty-members" aria-label={t('Program members')}>
      <h2>{t('Program members')}</h2>
      <p className="muted">
        {t(
          'Only customers enrolled in this shop are listed. Current balances are live; period-end balances and spending follow the selected dates in the shop timezone.',
        )}
      </p>
      <form
        className="loyalty-member-filters"
        onSubmit={(e) => {
          e.preventDefault();
          if (page === 1 && period.from === draft.from && period.to === draft.to) void q.refetch();
          setPage(1);
          setPeriod({ ...draft });
        }}
      >
        <Field label={t('From date')}>
          <input
            type="date"
            required
            value={draft.from}
            max={draft.to}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Field>
        <Field label={t('To date')}>
          <input
            type="date"
            required
            value={draft.to}
            min={draft.from}
            max={today}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </Field>
        <Button disabled={q.isFetching}>{t('Apply member filters')}</Button>
      </form>
      <ErrorMessage error={q.error} />
      {q.isPending ? (
        <p>{t('Loading…')}</p>
      ) : (
        r && (
          <>
            <div className="loyalty-member-totals">
              {[
                [t('Enrolled members'), String(r.total)],
                [t('Total current balance'), r.totals.currentBalance],
                [t('Total balance at period end'), r.totals.periodEndBalance],
                [t('Net points spent in period'), r.totals.spent],
              ].map(([label, value], i) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{i === 0 ? value : formatQuantity(value)}</strong>
                </div>
              ))}
            </div>
            <p className="muted">
              {t(
                'Net spent = points used − points restored by returns. Totals include every member, across all pages. Negative spending means more points were restored than used in this period.',
              )}
            </p>
            {Number(r.totals.negativeBalance) < 0 && (
              <p className="muted">
                {t('Available positive balances:')} {formatQuantity(r.totals.availableBalance)}.{' '}
                {t('Negative balances after returns:')} {formatQuantity(r.totals.negativeBalance)}.
              </p>
            )}
            <div className="loyalty-member-list">
              {r.members.length ? (
                r.members.map((m) => (
                  <article className="loyalty-member" key={m.id}>
                    <div className="loyalty-member-identity">
                      <strong>
                        {t('Member')} · {m.id.slice(0, 8).toUpperCase()}
                      </strong>
                      <small>
                        {t('Joined')}{' '}
                        {new Date(m.joinedAt).toLocaleDateString(getLocale(), {
                          timeZone: store.timezone,
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </small>
                    </div>
                    <dl>
                      <div>
                        <dt>{t('Current balance')}</dt>
                        <dd>{formatQuantity(m.currentBalance)}</dd>
                      </div>
                      <div>
                        <dt>{t('Balance at period end')}</dt>
                        <dd>{formatQuantity(m.periodEndBalance)}</dd>
                      </div>
                      <div>
                        <dt>{t('Net spent in period')}</dt>
                        <dd>{formatQuantity(m.spent)}</dd>
                        <small>
                          {t('Used:')} {formatQuantity(m.used)} · {t('Restored:')}{' '}
                          {formatQuantity(m.restored)}
                        </small>
                      </div>
                    </dl>
                  </article>
                ))
              ) : (
                <p>{t('No enrolled members yet.')}</p>
              )}
            </div>
            {r.total > r.pageSize && (
              <div className="loyalty-member-pagination">
                <Button
                  variant="outline"
                  disabled={page === 1 || q.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  {t('Previous')}
                </Button>
                <span>
                  {t('Page {page} of {pages}', { page, pages: Math.ceil(r.total / r.pageSize) })}
                </span>
                <Button
                  variant="outline"
                  disabled={page * r.pageSize >= r.total || q.isFetching}
                  onClick={() => setPage(page + 1)}
                >
                  {t('Next')}
                </Button>
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
