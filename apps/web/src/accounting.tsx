import { Link, Navigate } from '@tanstack/react-router';
import { useSession } from './api';
import { SalesSummary } from './sales-summary';
import { SalesHistorySection } from './reports';
import { t, useLanguage } from './i18n';
import './accounting.css';

export function AccountingPage({ section = 'summary' }: { section?: 'summary' | 'sales' }) {
  useLanguage();
  const session = useSession().data!;
  const allowed =
    session.user.permissions.includes('analytics.view') &&
    session.user.permissions.includes('analytics.margin') &&
    session.user.permissions.includes('expenses.read');
  const canReadSales = session.user.permissions.includes('sales.read');
  if (section === 'summary' && !allowed && canReadSales)
    return <Navigate to="/accounting/sales" replace />;
  return (
    <div className="accounting-page">
      <header className="page-heading">
        <div>
          <div className="eyebrow">ELIZA / {t('Accounting')}</div>
          <h1>{t('Accounting')}</h1>
          <p className="muted">
            {t(
              'Revenue, costs, profit and expenses in one place. Choose the period you want to review.',
            )}
          </p>
        </div>
        {session.user.permissions.includes('expenses.read') && (
          <Link to="/expenses" className="button button-outline">
            {t('Expense records')}
          </Link>
        )}
      </header>
      <nav className="accounting-sections" aria-label={t('Accounting sections')}>
        {allowed && (
          <Link
            to="/accounting"
            activeOptions={{ exact: true }}
            aria-current={section === 'summary' ? 'page' : undefined}
          >
            {t('Financial summary')}
          </Link>
        )}
        {canReadSales && (
          <Link
            to="/accounting/sales"
            activeOptions={{ exact: true }}
            aria-current={section === 'sales' ? 'page' : undefined}
          >
            {t('Sales')}
          </Link>
        )}
      </nav>
      {section === 'sales' ? (
        canReadSales ? (
          <SalesHistorySection />
        ) : (
          <p className="notice">{t('Access restricted')}</p>
        )
      ) : allowed ? (
        <SalesSummary accounting />
      ) : (
        <p className="notice">{t('Access restricted')}</p>
      )}
    </div>
  );
}
