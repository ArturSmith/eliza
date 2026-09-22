import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type DocumentData, type DocumentValidation, validateDocument } from '@eliza/contracts';
import { api, queryClient } from './api';
import { t, useLanguage } from './i18n';
import { ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { DocumentPurchasePreparation } from './document-purchase';

type DocumentRecord = {
  id: string;
  filename: string;
  mimeType: string;
  documentType: string;
  extracted: DocumentData;
  edited: DocumentData;
  validation: DocumentValidation;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type DocumentSummary = Pick<
  DocumentRecord,
  'id' | 'filename' | 'documentType' | 'version' | 'createdAt' | 'updatedAt'
>;
function displayAmount(value: string | null, currency: string, language: string) {
  if (value === null) return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return (
    new Intl.NumberFormat(language.toLowerCase().startsWith('ru') ? 'ru-RU' : 'en-GB', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(number) + (currency ? ' ' + currency : '')
  );
}
function DocumentViewer({
  record,
  onSaved,
}: {
  record: DocumentRecord;
  onSaved: (next: DocumentRecord) => void;
}) {
  const [data, setData] = useState<DocumentData>(() => structuredClone(record.edited));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setData(structuredClone(record.edited));
    setEditing(false);
    setError(null);
  }, [record.id, record.version]);
  const validation = validateDocument(data);
  const changed = JSON.stringify(data) !== JSON.stringify(record.edited);
  function change(mutator: (draft: DocumentData) => void) {
    setData((current) => {
      const draft = structuredClone(current);
      mutator(draft);
      return draft;
    });
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await api<DocumentRecord>('/documents/' + record.id + '/save', {
        data,
        version: record.version,
      });
      onSaved(saved);
      void queryClient.invalidateQueries({ queryKey: ['scanned-documents'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function editText(
    value: string | null,
    onChange: (value: string) => void,
    label: string,
    original?: string | null,
    multiline = false,
  ) {
    if (!editing) return <span>{value || '—'}</span>;
    return (
      <span
        className={original !== undefined && original !== value ? 'document-edited' : undefined}
      >
        {multiline ? (
          <textarea
            aria-label={label}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            aria-label={label}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        {original !== undefined && original !== value && (
          <small title={original ?? undefined}>{t('Edited from scan')}</small>
        )}
      </span>
    );
  }
  return (
    <section className="scanned-document-result">
      <div className="document-result-toolbar">
        <div>
          <span className={validation.incomplete ? 'document-review-badge' : 'document-scan-badge'}>{validation.incomplete ? '⚠ ' + t('Review required') : '✓ ' + t('Scan complete')}</span>
          <span className="document-type-badge">{data.documentType || t('Document')}</span>
        </div>
        <div className="document-result-actions">
          <Button type="button" variant="outline" onClick={() => window.print()}>
            {t('Export PDF')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setData(structuredClone(record.edited));
              setEditing(!editing);
            }}
          >
            {editing ? t('Cancel editing') : t('Edit document')}
          </Button>
          {editing && (
            <Button type="button" disabled={busy || !changed} onClick={() => void save()}>
              {busy ? t('Saving…') : t('Save corrections')}
            </Button>
          )}
        </div>
      </div>
      <ErrorMessage error={error} />
      <div className="document-result-columns">
        <aside className="document-original">
          <h2>{t('Original scan')}</h2>
          {record.mimeType === 'application/pdf' ? (
            <iframe title={t('Original PDF')} src={'/api/documents/' + record.id + '/file'} />
          ) : (
            <img
              src={'/api/documents/' + record.id + '/file'}
              alt={t('Original scanned document')}
            />
          )}
          <small>{record.filename}</small>
        </aside>
        <article className="document-paper">
          <header className="document-paper-header">
            <div className="document-paper-heading">
              <span className={validation.incomplete ? 'document-review-badge' : 'document-scan-badge'}>{validation.incomplete ? '⚠ ' + t('Review required') : '✓ ' + t('Scan complete')}</span>
              <span className="document-type-badge">{data.documentType || t('Document')}</span>
            </div>
            <h2>
              {editText(
                data.title,
                (value) =>
                  change((draft) => {
                    draft.title = value;
                  }),
                t('Document title'),
                record.extracted.title,
              )}
            </h2>
            <div className="document-paper-meta">
              <label>
                {t('Number')}{' '}
                {editText(
                  data.number,
                  (value) =>
                    change((draft) => {
                      draft.number = value;
                    }),
                  t('Document number'),
                  record.extracted.number,
                )}
              </label>
              <label>
                {t('Date')}{' '}
                {editText(
                  data.date,
                  (value) =>
                    change((draft) => {
                      draft.date = value;
                    }),
                  t('Document date'),
                  record.extracted.date,
                )}
              </label>
            </div>
          </header>
          {data.parties.length > 0 && (
            <div className="document-parties">
              {data.parties.map((party, i) => (
                <div key={i}>
                  <span className="document-label">
                    {editText(
                      party.role,
                      (value) =>
                        change((draft) => {
                          draft.parties[i].role = value;
                        }),
                      t('Party role'),
                      record.extracted.parties[i]?.role,
                    )}
                  </span>
                  <strong>
                    {editText(
                      party.name,
                      (value) =>
                        change((draft) => {
                          draft.parties[i].name = value;
                        }),
                      t('Party name'),
                      record.extracted.parties[i]?.name,
                    )}
                  </strong>
                  {party.details && (
                    <p>
                      {editText(
                        party.details,
                        (value) =>
                          change((draft) => {
                            draft.parties[i].details = value;
                          }),
                        t('Party details'),
                        record.extracted.parties[i]?.details,
                        true,
                      )}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {data.fields.length > 0 && (
            <dl className="document-fields">
              {data.fields.map((field, i) => (
                <div key={i}>
                  <dt>
                    {editText(
                      field.label,
                      (value) =>
                        change((draft) => {
                          draft.fields[i].label = value;
                        }),
                      t('Field label'),
                      record.extracted.fields[i]?.label,
                    )}
                  </dt>
                  <dd>
                    {editText(
                      field.value,
                      (value) =>
                        change((draft) => {
                          draft.fields[i].value = value;
                          draft.fields[i].uncertain = false;
                        }),
                      t('Field value'),
                      record.extracted.fields[i]?.value,
                    )}
                    {field.uncertain && <em>{t('Uncertain')}</em>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {data.summary && (
            <p className="document-summary">
              {editText(
                data.summary,
                (value) =>
                  change((draft) => {
                    draft.summary = value;
                  }),
                t('Summary'),
                record.extracted.summary,
                true,
              )}
            </p>
          )}
          {data.sections.map((section, i) => (
            <section className="document-section" key={i}>
              <h3>
                {editText(
                  section.title,
                  (value) =>
                    change((draft) => {
                      draft.sections[i].title = value;
                    }),
                  t('Section title'),
                  record.extracted.sections[i]?.title,
                )}
              </h3>
              <p>
                {editText(
                  section.text,
                  (value) =>
                    change((draft) => {
                      draft.sections[i].text = value;
                    }),
                  t('Section text'),
                  record.extracted.sections[i]?.text,
                  true,
                )}
              </p>
            </section>
          ))}
          {data.tables.map((table, tableIndex) => (
            <section className="document-section" key={table.id || tableIndex}>
              <h3>
                {editText(
                  table.title,
                  (value) =>
                    change((draft) => {
                      draft.tables[tableIndex].title = value;
                    }),
                  t('Table title'),
                  record.extracted.tables[tableIndex]?.title,
                )}
              </h3>
              <div className="document-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      {table.columns.map((column, columnIndex) => (
                        <th
                          key={column.key || columnIndex}
                          className={
                            ['amount', 'price', 'quantity', 'number'].includes(column.kind)
                              ? 'numeric'
                              : ''
                          }
                        >
                          {editText(
                            column.label,
                            (value) =>
                              change((draft) => {
                                draft.tables[tableIndex].columns[columnIndex].label = value;
                              }),
                            t('Column label'),
                            record.extracted.tables[tableIndex]?.columns[columnIndex]?.label,
                          )}
                        </th>
                      ))}
                      {editing && <th>{t('Actions')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        <td>
                          {editText(
                            row.rowNumber,
                            (value) =>
                              change((draft) => {
                                draft.tables[tableIndex].rows[rowIndex].rowNumber = value;
                              }),
                            t('Row number'),
                            record.extracted.tables[tableIndex]?.rows[rowIndex]?.rowNumber,
                          )}
                        </td>
                        {row.cells.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className={
                              ['amount', 'price', 'quantity', 'number'].includes(
                                table.columns[cellIndex]?.kind,
                              )
                                ? 'numeric'
                                : ''
                            }
                          >
                            {editText(
                              cell,
                              (value) =>
                                change((draft) => {
                                  draft.tables[tableIndex].rows[rowIndex].cells[cellIndex] = value;
                                }),
                              table.columns[cellIndex]?.label || t('Cell'),
                              record.extracted.tables[tableIndex]?.rows[rowIndex]?.cells[cellIndex],
                            )}
                            {row.uncertainCells?.includes(cellIndex) && <small className="document-cell-uncertain">{t('Uncertain')}</small>}
                          </td>
                        ))}
                        {editing && (
                          <td>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() =>
                                change((draft) => {
                                  draft.tables[tableIndex].rows.splice(rowIndex, 1);
                                })
                              }
                            >
                              {t('Remove row')}
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  {table.footerRows.length > 0 && (
                    <tfoot>
                      {table.footerRows.map((footer, footerIndex) => (
                        <tr key={footerIndex}>
                          <th colSpan={table.columns.length}>
                            {editText(
                              footer.label,
                              (value) =>
                                change((draft) => {
                                  draft.tables[tableIndex].footerRows[footerIndex].label = value;
                                }),
                              t('Footer label'),
                              record.extracted.tables[tableIndex]?.footerRows[footerIndex]?.label,
                            )}
                          </th>
                          <td className="numeric">
                            {editText(
                              footer.value,
                              (value) =>
                                change((draft) => {
                                  draft.tables[tableIndex].footerRows[footerIndex].value = value;
                                }),
                              t('Footer value'),
                              record.extracted.tables[tableIndex]?.footerRows[footerIndex]?.value,
                            )}
                          </td>
                          {editing && <td />}
                        </tr>
                      ))}
                    </tfoot>
                  )}
                </table>
              </div>
              {editing && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    change((draft) => {
                      const target = draft.tables[tableIndex];
                      target.rows.push({
                        rowNumber: String(target.rows.length + 1),
                        cells: target.columns.map(() => ''),
                      });
                    })
                  }
                >
                  {t('Add row')}
                </Button>
              )}
            </section>
          ))}
          {(data.additionalText.length > 0 || data.annotations.length > 0) && (
            <section className="document-section">
              <h3>{t('Additional details')}</h3>
              {data.additionalText.map((value, i) => (
                <p key={'text-' + i}>
                  {editText(
                    value,
                    (next) =>
                      change((draft) => {
                        draft.additionalText[i] = next;
                      }),
                    t('Additional text'),
                    record.extracted.additionalText[i],
                    true,
                  )}
                </p>
              ))}
              {data.annotations.map((value, i) => (
                <p key={'annotation-' + i}>
                  <em>{t('Annotation')}:</em>{' '}
                  {editText(
                    value,
                    (next) =>
                      change((draft) => {
                        draft.annotations[i] = next;
                      }),
                    t('Annotation'),
                    record.extracted.annotations[i],
                    true,
                  )}
                </p>
              ))}
            </section>
          )}
          {(data.printedTotal || validation.rowSum !== null) && (
            <section className="document-totals">
              <div>
                <strong>{t('Printed document total')}</strong>
                <strong>
                  {editText(
                    data.printedTotal,
                    (value) =>
                      change((draft) => {
                        draft.printedTotal = value;
                      }),
                    t('Printed document total'),
                    record.extracted.printedTotal,
                  )}
                </strong>
              </div>
              {validation.rowSum !== null && (
                <div>
                  <span>{validation.incomplete ? t('Partial sum of extracted rows') : t('Sum of table rows')}</span>
                  <span>{displayAmount(validation.rowSum, data.currency, data.language)}</span>
                </div>
              )}
              {validation.difference !== null && validation.difference !== '0.00' && (
                <p className="document-discrepancy">
                  ⚠ {validation.incomplete ? t('Partial sum differs from printed total') : t('Discrepancy detected')}:{' '}
                  {displayAmount(
                    String(Math.abs(Number(validation.difference))),
                    data.currency,
                    data.language,
                  )}
                </p>
              )}
            </section>
          )}
          {validation.expectedRows !== null && (
            <p className={validation.incomplete ? 'document-row-count incomplete' : 'document-row-count'}>
              {t('Extracted {count} of {expected} expected rows.', { count: validation.extractedRows, expected: validation.expectedRows })}
            </p>
          )}
          {validation.warnings.length > 0 && (
            <div className="document-warnings">
              <h3>{t('Review warnings')}</h3>
              {validation.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
type ChatMessage =
  | { id: number; role: 'user' | 'assistant'; text: string }
  | { id: number; role: 'document'; documentId: string; filename: string };

export function ScannedDocumentsPage() {
  useLanguage();
  const [selectedId, setSelectedId] = useState(
    () => new URLSearchParams(window.location.search).get('id') || '',
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [processingFile, setProcessingFile] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [record, setRecord] = useState<DocumentRecord | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const nextId = () => ++sequence.current;
  const list = useQuery({
    queryKey: ['scanned-documents'],
    queryFn: () => api<DocumentSummary[]>('/documents'),
  });
  const detail = useQuery({
    queryKey: ['scanned-document', selectedId],
    queryFn: () => api<DocumentRecord>('/documents/' + selectedId),
    enabled: !!selectedId,
  });
  useEffect(() => {
    if (!detail.data) return;
    setRecord(detail.data);
    setMessages((current) =>
      current.some((message) => message.role === 'document' && message.documentId === detail.data.id)
        ? current
        : [...current, { id: nextId(), role: 'document', documentId: detail.data.id, filename: detail.data.filename }],
    );
  }, [detail.data]);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);
  function choose(next?: File) {
    setError(null);
    if (!next) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(next.type) ||
      next.size > 8_000_000
    ) {
      setError('Choose a JPEG, PNG, WebP, or PDF file smaller than 8 MB.');
      return;
    }
    setFile(next);
  }
  async function send() {
    const text = question.trim();
    const attachment = file;
    if ((!attachment && !text) || busy) return;
    const conversationHistory = messages
      .filter((message): message is Extract<ChatMessage, { role: 'user' | 'assistant' }> => message.role !== 'document')
      .slice(-12)
      .map((message) => ({ role: message.role, content: message.text }));
    setQuestion('');
    setFile(null);
    setError(null);
    setMessages((current) => [...current, { id: nextId(), role: 'user', text: text || attachment!.name }]);
    setBusy(true);
    setProcessingFile(!!attachment);
    let scanCompleted = false;
    try {
      let documentId = record?.id;
      if (attachment) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('The file could not be opened.'));
          reader.readAsDataURL(attachment);
        });
        const saved = await api<DocumentRecord>('/documents/scan', { filename: attachment.name, dataUrl });
        scanCompleted = true;
        setRecord(saved);
        setSelectedId(saved.id);
        documentId = saved.id;
        history.replaceState(null, '', '/documents?id=' + saved.id);
        void queryClient.invalidateQueries({ queryKey: ['scanned-documents'] });
        setMessages((current) => [...current, { id: nextId(), role: 'document', documentId: saved.id, filename: saved.filename }]);
        setProcessingFile(false);
      }
      if (text) {
        const reply = await api<{ answer: string }>('/documents/chat', { documentId, question: text, history: conversationHistory });
        setMessages((current) => [...current, { id: nextId(), role: 'assistant', text: reply.answer }]);
      }
    } catch (cause) {
      if (attachment && !scanCompleted) setFile(attachment);
      if (text) setQuestion(text);
      setError(cause);
    } finally {
      setBusy(false);
      setProcessingFile(false);
    }
  }
  const initial = messages.length === 0 && !selectedId;
  return (
    <div className={'documents-page document-assistant' + (initial ? ' document-assistant-initial' : '')}>
      <header className="document-assistant-header">
        <span>{t('AI DOCUMENT ASSISTANT')}</span>
        <button type="button" className="document-history-button" aria-label={t('Previous scans')} title={t('Previous scans')} onClick={() => setShowHistory((value) => !value)} aria-expanded={showHistory}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
        </button>
      </header>
      {showHistory && (
        <aside className="document-history" aria-label={t('Previous scans')}>
          <h2>{t('Previous scans')}</h2>
          <ErrorMessage error={list.error} />
          {list.isPending && <p>{t('Loading…')}</p>}
          {list.data?.length === 0 && <p>{t('No scanned documents yet.')}</p>}
          {list.data?.map((item) => (
            <button type="button" key={item.id} className="document-library-item" onClick={() => {
              setSelectedId(item.id);
              setRecord(null);
              setMessages([]);
              setShowHistory(false);
              history.replaceState(null, '', '/documents?id=' + item.id);
            }}>
              <strong>{item.filename}</strong>
              <time>{new Date(item.createdAt).toLocaleDateString()}</time>
            </button>
          ))}
        </aside>
      )}
      <div className="document-conversation" aria-live="polite">
        {initial ? (
          <div className="document-welcome">
            <h1>{t('What would you like to scan?')}</h1>
            <p>{t('Upload a document to get started.')}</p>
          </div>
        ) : (
          <div className="document-message-list">
            {messages.map((message) => message.role === 'document' ? (
              <div key={message.id} className="document-message document-message-result">
                {record?.id === message.documentId && (
                  <DocumentViewer record={record} onSaved={(next) => {
                    setRecord(next);
                    void queryClient.invalidateQueries({ queryKey: ['scanned-document', next.id] });
                  }} />
                )}
                {record?.id === message.documentId && <DocumentPurchasePreparation data={record.edited} documentId={record.id} />}
              </div>
            ) : (
              <div key={message.id} className={'document-message document-message-' + message.role}>
                <div className="document-message-text">{message.text}</div>
              </div>
            ))}
            {busy && <p role="status" className="document-scan-progress">{processingFile ? t('Reading your document…') : t('Thinking…')}</p>}
            <div ref={endRef} />
          </div>
        )}
      </div>
      <div className="document-composer-wrap">
        <ErrorMessage error={error || detail.error} />
        <form className="document-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          {file && (
            <div className="document-attachment-preview">
              {file.type.startsWith('image/') && preview ? <img src={preview} alt="" /> : <span className="document-attachment-pdf">PDF</span>}
              <span title={file.name}>{file.name}</span>
              <button type="button" aria-label={t('Remove attachment')} onClick={() => setFile(null)}>×</button>
            </div>
          )}
          <textarea aria-label={t('Upload a document or ask anything...')} placeholder={t('Upload a document or ask anything...')} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
          }} rows={1} />
          <div className="document-composer-actions">
            <div className="document-attach-wrap">
              <button type="button" className="document-attach-button" aria-label={t('Attach document')} title={t('Attach document')} aria-expanded={showAttachMenu} onClick={() => setShowAttachMenu((value) => !value)}>+</button>
              {showAttachMenu && <div className="document-attach-menu">
                <button type="button" onClick={() => { setShowAttachMenu(false); fileInput.current?.click(); }}>{t('Choose file')}</button>
                <button type="button" onClick={() => { setShowAttachMenu(false); cameraInput.current?.click(); }}>{t('Take photo')}</button>
              </div>}
              <input ref={fileInput} type="file" aria-label={t('Choose file')} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ''; }} hidden />
              <input ref={cameraInput} type="file" aria-label={t('Take photo')} accept="image/*" capture="environment" onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ''; }} hidden />
            </div>
            <button type="submit" className="document-send-button" aria-label={t('Send')} title={t('Send')} disabled={busy || (!file && !question.trim())}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
