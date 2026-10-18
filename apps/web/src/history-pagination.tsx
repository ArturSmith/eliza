import { t } from './i18n';
import { Button } from './components/ui/button';
export type HistoryPage<T> = { rows: T[]; total: number; page: number; pageSize: number };
export function HistoryPagination({
  page,
  total,
  busy,
  onChange,
}: {
  page: number;
  total: number;
  busy: boolean;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / 50));
  return (
    <div className="movement-pagination">
      <Button variant="outline" disabled={page <= 1 || busy} onClick={() => onChange(page - 1)}>
        {t('Previous')}
      </Button>
      <span aria-live="polite">{t('Page {page} of {pages}', { page, pages })}</span>
      <Button variant="outline" disabled={page >= pages || busy} onClick={() => onChange(page + 1)}>
        {t('Next')}
      </Button>
    </div>
  );
}
