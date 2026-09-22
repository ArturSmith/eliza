import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText, Search } from 'lucide-react';
import { api, queryClient, useSession } from './api';
import { ErrorMessage } from './forms';
import { t, useLanguage, getLocale } from './i18n';
import { DocumentViewer, type DocumentRecord } from './scanned-documents';

type DocumentSummary = {
  id: string;
  filename: string;
  documentType: string;
  status: 'draft' | 'saved';
  createdAt: string;
  updatedAt: string;
};

export function DigitalPurchasesPage() {
  useLanguage();
  const session = useSession();
  const canEdit = session.data?.user.permissions.includes('purchases.write') ?? false;
  const [search, setSearch] = useState('');
  const selectedId = new URLSearchParams(window.location.search).get('id') || '';
  const list = useQuery({
    queryKey: ['scanned-documents', search],
    queryFn: () => api<DocumentSummary[]>('/documents?search=' + encodeURIComponent(search)),
  });
  const detail = useQuery({
    queryKey: ['scanned-document', selectedId],
    queryFn: () => api<DocumentRecord>('/documents/' + selectedId),
    enabled: !!selectedId,
  });
  const date = (value: string) => new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium', timeStyle: 'short', timeZone: session.data?.store.timezone ?? 'UTC',
  }).format(new Date(value));

  if (selectedId) return (
    <div className="digital-purchases-page">
      <a className="digital-purchases-back" href="/digital-purchases"><ArrowLeft size={18} />{t('Digital purchases')}</a>
      {detail.isPending && <p>{t('Loading…')}</p>}
      <ErrorMessage error={detail.error} />
      {detail.data && <>
        <div className="page-heading digital-purchases-heading">
          <div><span className="eyebrow">{t('Digital purchases')}</span><h1>{detail.data.edited.title || detail.data.filename}</h1><p className="muted">{detail.data.filename}</p></div>
          <a className="button button-outline" href={'/ai?document=' + detail.data.id}>{t('Open in Eliza AI')}</a>
        </div>
        <DocumentViewer
          record={detail.data}
          canEdit={canEdit}
          onSaved={(saved) => {
            queryClient.setQueryData(['scanned-document', saved.id], saved);
            void queryClient.invalidateQueries({ queryKey: ['scanned-documents'] });
          }}
        />
      </>}
    </div>
  );

  return (
    <div className="digital-purchases-page">
      <div className="page-heading digital-purchases-heading">
        <div><span className="eyebrow">{t('Stock & purchasing')}</span><h1>{t('Digital purchases')}</h1><p className="muted">{t('Scanned supplier documents are stored here separately from purchase orders.')}</p></div>
      </div>
      <section className="panel digital-purchases-panel">
        <div className="table-toolbar">
          <div className="search-box"><Search size={18} /><input aria-label={t('Search digital purchases')} placeholder={t('Search filename, document number, or title…')} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <span className="muted">{list.data?.length ?? 0} {t('documents')}</span>
        </div>
        <ErrorMessage error={list.error} />
        {list.isPending && <p className="digital-purchases-empty">{t('Loading…')}</p>}
        {list.data?.length === 0 && <p className="digital-purchases-empty">{t('No digital purchases yet. Upload a supplier document in Eliza AI to get started.')}</p>}
        {!!list.data?.length && <div className="digital-purchases-list">
          {list.data.map((document) => <a href={'/digital-purchases?id=' + document.id} className="digital-purchases-item" key={document.id}>
            <span className="digital-purchases-icon"><FileText size={21} /></span>
            <span className="digital-purchases-info"><strong>{document.filename}</strong><small>{document.documentType || t('Scanned document')} · {date(document.createdAt)}</small></span>
            <span className={'digital-purchases-status ' + document.status}>{t(document.status === 'saved' ? 'Saved digital document' : 'Draft digital document')}</span>
          </a>)}
        </div>}
      </section>
    </div>
  );
}
