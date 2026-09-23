import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText, Search, Trash2 } from 'lucide-react';
import { api, queryClient, useSession } from './api';
import { ErrorMessage } from './forms';
import { Dialog } from './components/ui/dialog';
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
  const [deleting, setDeleting] = useState<{ id: string; filename: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
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

  async function removeDocument() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api('/documents/' + deleting.id, undefined, 'DELETE');
      queryClient.removeQueries({ queryKey: ['scanned-document', deleting.id] });
      await queryClient.invalidateQueries({ queryKey: ['scanned-documents'] });
      setDeleting(null);
      if (selectedId === deleting.id) window.location.assign('/digital-purchases');
    } catch (error) { setDeleteError(error); } finally { setDeleteBusy(false); }
  }
  const confirmation = <Dialog open={!!deleting} onOpenChange={(open) => { if (!open && !deleteBusy) { setDeleting(null); setDeleteError(null); } }} title={t('Delete digital purchase?')} description={t('The scan and extracted details will be permanently deleted. Chat messages stay, but their document attachment will no longer open. Purchase orders are unaffected.')}><ErrorMessage error={deleteError} /><div className="dialog-actions"><button type="button" className="button button-outline" disabled={deleteBusy} onClick={() => setDeleting(null)}>{t('Cancel')}</button><button type="button" className="button button-danger" disabled={deleteBusy} onClick={() => void removeDocument()}>{deleteBusy ? t('Deleting…') : t('Delete digital purchase')}</button></div></Dialog>;

  if (selectedId) return (
    <div className="digital-purchases-page">
      <a className="digital-purchases-back" href="/digital-purchases"><ArrowLeft size={18} />{t('Digital purchases')}</a>
      {detail.isPending && <p>{t('Loading…')}</p>}
      <ErrorMessage error={detail.error} />
      {detail.data && <>
        <div className="page-heading digital-purchases-heading">
          <div><span className="eyebrow">{t('Digital purchases')}</span><h1>{detail.data.edited.title || detail.data.filename}</h1><p className="muted">{detail.data.filename}</p></div>
          <div className="digital-purchases-actions"><a className="button button-outline" href={'/ai?document=' + detail.data.id}>{t('Open in Eliza AI')}</a>{canEdit && <button type="button" className="button button-outline" onClick={() => setDeleting({ id: detail.data.id, filename: detail.data.filename })}><Trash2 size={16} />{t('Delete')}</button>}</div>
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
      {confirmation}
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
          {list.data.map((document) => <div className="digital-purchases-row" key={document.id}><a href={'/digital-purchases?id=' + document.id} className="digital-purchases-item">
            <span className="digital-purchases-icon"><FileText size={21} /></span>
            <span className="digital-purchases-info"><strong>{document.filename}</strong><small>{document.documentType || t('Scanned document')} · {date(document.createdAt)}</small></span>
            <span className={'digital-purchases-status ' + document.status}>{t(document.status === 'saved' ? 'Saved digital document' : 'Draft digital document')}</span>
          </a>{canEdit && <button type="button" className="digital-purchases-delete" aria-label={t('Delete digital purchase') + ': ' + document.filename} onClick={() => setDeleting({ id: document.id, filename: document.filename })}><Trash2 size={18} /></button>}</div>)}
        </div>}
      </section>
      {confirmation}
    </div>
  );
}
