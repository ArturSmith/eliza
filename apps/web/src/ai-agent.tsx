import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, Clock3, FileText, Paperclip, Plus, Sparkles, X } from 'lucide-react';
import { api, queryClient, useSession } from './api';
import { ErrorMessage } from './forms';
import { t, useLanguage } from './i18n';

type Conversation = { id: string; title: string; created_at: string; updated_at: string };
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  document_id: string | null;
  created_at: string;
};
type Detail = { conversation: Conversation; messages: Message[] };
type Document = { id: string; filename: string; documentType: string };
const accepted = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const fileLimit = 8_000_000;
function messageContent(text: string) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    if (/^\|.+\|$/.test(lines[index]) && /^\|[\s:|-]+\|$/.test(lines[index + 1] ?? '')) {
      const headers = lines[index]
        .split('|')
        .slice(1, -1)
        .map((v) => v.trim());
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\|.+\|$/.test(lines[index]))
        rows.push(
          lines[index++]
            .split('|')
            .slice(1, -1)
            .map((v) => v.trim()),
        );
      blocks.push(
        <div className="ai-table-scroll" key={blocks.length}>
          <table>
            <thead>
              <tr>
                {headers.map((header, i) => (
                  <th key={i}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const line = lines[index++];
    if (!line.trim()) continue;
    const parts = line.split(/(\/documents\?id=[a-f0-9-]{36})/gi);
    blocks.push(
      <p key={blocks.length}>
        {parts.map((part, i) =>
          /^\/documents\?id=[a-f0-9-]{36}$/i.test(part) ? (
            <a href={part} key={i}>
              {t('Open scanned document')}
            </a>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>,
    );
  }
  return blocks;
}
async function sendStream(
  id: string,
  message: string,
  documentId: string,
  onDelta: (text: string) => void,
): Promise<Detail> {
  const response = await fetch('/api/ai/conversations/' + id + '/messages/stream', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Eliza-Request': '1' },
    body: JSON.stringify({ message, ...(documentId ? { documentId } : {}) }),
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || t('Eliza AI could not complete the request. Try again.'));
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: Detail | undefined;
  const consume = (frame: string) => {
    const event = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim();
    const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!event || !data) return;
    const value = JSON.parse(data);
    if (event === 'delta' && typeof value.text === 'string') onDelta(value.text);
    if (event === 'done') result = value as Detail;
    if (event === 'error') throw new Error(value.message || t('Eliza AI could not complete the request. Try again.'));
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
    }
  }
  if (buffer.trim()) consume(buffer);
  if (!result) throw new Error(t('Eliza AI did not finish its answer. Try again.'));
  return result;
}
export function AiAgentPage() {
  useLanguage();
  const session = useSession();
  const canDocuments = session.data?.user.permissions.includes('purchases.read') ?? false;
  const [id, setId] = useState(() => new URLSearchParams(window.location.search).get('id') || '');
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [showDocuments, setShowDocuments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState('');
  const [streamed, setStreamed] = useState('');
  const [localMessages, setLocalMessages] = useState<Message[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const history = useQuery({
    queryKey: ['ai-conversations'],
    queryFn: () => api<Conversation[]>('/ai/conversations'),
  });
  const detail = useQuery({
    queryKey: ['ai-conversation', id],
    queryFn: () => api<Detail>('/ai/conversations/' + id),
    enabled: !!id,
  });
  const documents = useQuery({
    queryKey: ['scanned-documents'],
    queryFn: () => api<Document[]>('/documents'),
    enabled: canDocuments && showDocuments,
  });
  useEffect(() => {
    setLocalMessages(null);
  }, [id]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [detail.data, localMessages, pending, streamed, busy]);
  const messages = localMessages ?? detail.data?.messages ?? [];
  const chosen = documents.data?.find((doc) => doc.id === documentId);
  function selectConversation(next: string) {
    setId(next);
    setDraft('');
    setFile(null);
    setDocumentId('');
    setDocumentName('');
    setError(null);
    setShowHistory(false);
    setShowDocuments(false);
    window.history.replaceState(null, '', next ? '/ai?id=' + next : '/ai');
  }
  function chooseFile(next?: File) {
    if (!next) return;
    if (!accepted.includes(next.type) || next.size > fileLimit) {
      setError(t('Choose a JPEG, PNG, WebP, or PDF file smaller than 8 MB.'));
      return;
    }
    setFile(next);
    setDocumentId('');
    setDocumentName('');
    setShowDocuments(false);
    setError(null);
  }
  async function upload(selected: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(t('The file could not be opened.')));
      reader.readAsDataURL(selected);
    });
    const result = await api<{ id: string }>('/documents/scan', {
      filename: selected.name,
      dataUrl,
    });
    void queryClient.invalidateQueries({ queryKey: ['scanned-documents'] });
    return result.id;
  }
  async function send() {
    const text =
      draft.trim() || (file || documentId ? t('Please review this scanned document.') : '');
    if (!text || busy || (id && detail.isPending && !localMessages)) return;
    setBusy(true);
    setPending(text);
    setStreamed('');
    setError(null);
    let conversationId = id;
    try {
      if (!conversationId) {
        const created = await api<Conversation>('/ai/conversations', {});
        conversationId = created.id;
        setId(conversationId);
        window.history.replaceState(null, '', '/ai?id=' + conversationId);
        void queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
      }
      let attached = documentId;
      if (file) {
        attached = await upload(file);
        setDocumentId(attached);
        setDocumentName(file.name);
        setFile(null);
      }
      const result = await sendStream(conversationId, text, attached, (chunk) =>
        setStreamed((current) => current + chunk),
      );
      setLocalMessages((current) => [
        ...(current ?? detail.data?.messages ?? []),
        ...result.messages,
      ]);
      setDraft('');
      setDocumentId('');
      setDocumentName('');
      void queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['ai-conversation', conversationId] });
    } catch (cause) {
      setError(cause);
      setDraft(text);
    } finally {
      setPending('');
      setStreamed('');
      setBusy(false);
    }
  }
  return (
    <div className="ai-page">
      <aside className={'ai-history' + (showHistory ? ' is-open' : '')}>
        <div className="ai-history-heading">
          <strong>{t('Eliza AI')}</strong>
          <button
            type="button"
            aria-label={t('Close history')}
            onClick={() => setShowHistory(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button type="button" className="ai-new" onClick={() => selectConversation('')}>
          <Plus size={17} />
          {t('New conversation')}
        </button>
        <div className="ai-history-list">
          <span className="ai-history-label">{t('Recent conversations')}</span>
          <ErrorMessage error={history.error} />
          {history.data?.map((item) => (
            <button
              type="button"
              className={id === item.id ? 'active' : ''}
              key={item.id}
              onClick={() => selectConversation(item.id)}
            >
              <Clock3 size={15} />
              <span>{item.title}</span>
            </button>
          ))}
          {history.data?.length === 0 && <p>{t('No conversations yet.')}</p>}
        </div>
      </aside>
      <main className="ai-main">
        <header className="ai-header">
          <button
            type="button"
            className="ai-history-toggle"
            onClick={() => setShowHistory((v) => !v)}
            aria-label={t('Conversation history')}
          >
            <Clock3 size={20} />
          </button>
          <span>
            <Sparkles size={18} />
            {t('Eliza AI')}
          </span>
          <button
            type="button"
            onClick={() => selectConversation('')}
            aria-label={t('New conversation')}
          >
            <Plus size={20} />
          </button>
        </header>
        <div className="ai-thread" role="log" aria-live="polite">
          {!id && !messages.length && (
            <div className="ai-welcome">
              <span className="ai-welcome-icon">
                <Sparkles size={30} />
              </span>
              <h1>{t('How can I help your store?')}</h1>
              <p>{t('Ask about sales, products, stock, purchases or scanned documents.')}</p>
            </div>
          )}
          <div className="ai-messages">
            <ErrorMessage error={detail.error} />
            {messages.map((message) => (
              <div className={'ai-message ai-message-' + message.role} key={message.id}>
                <div className="ai-message-label">
                  {message.role === 'assistant' ? t('Eliza AI') : t('You')}
                </div>
                <div className="ai-message-body">{messageContent(message.content)}</div>
                {message.document_id && (
                  <a className="ai-document-card" href={'/documents?id=' + message.document_id}>
                    <FileText size={19} />
                    <span>
                      {t('Open scanned document')}
                      <small>{t('AI-extracted document — review before using')}</small>
                    </span>
                  </a>
                )}
              </div>
            ))}
            {pending && (
              <div className="ai-message ai-message-user ai-pending">
                <div className="ai-message-label">{t('You')}</div>
                <div className="ai-message-body">
                  <p>{pending}</p>
                </div>
              </div>
            )}
            {streamed && (
              <div className="ai-message ai-message-assistant ai-streaming">
                <div className="ai-message-label">{t('Eliza AI')}</div>
                <div className="ai-message-body">{messageContent(streamed)}</div>
              </div>
            )}
            {busy && !streamed && (
              <div className="ai-thinking" role="status">
                <span className="thinking-dots">
                  {file ? t('Reading your document…') : t('Thinking…')}
                </span>
              </div>
            )}
            <div ref={end} />
          </div>
        </div>
        <div className="ai-composer-wrap">
          <ErrorMessage error={error} />
          <div className="ai-composer">
            {(file || documentId) && (
              <div className="ai-attachment">
                <FileText size={17} />
                <span>
                  {file?.name || documentName || chosen?.filename || t('Scanned document')}
                </span>
                <button
                  type="button"
                  aria-label={t('Remove attachment')}
                  onClick={() => {
                    setFile(null);
                    setDocumentId('');
                    setDocumentName('');
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <textarea
              aria-label={t('Ask Eliza AI')}
              placeholder={t('Ask Eliza AI anything about your store…')}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
            />
            <div className="ai-composer-actions">
              <div className="ai-attach-actions">
                {canDocuments && (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      accept={accepted.join(',')}
                      hidden
                      aria-label={t('Upload document')}
                      onChange={(event) => {
                        chooseFile(event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      className="ai-attach"
                      aria-label={t('Upload document')}
                      title={t('Upload document')}
                      onClick={() => fileInput.current?.click()}
                    >
                      <Paperclip size={20} />
                    </button>
                    <button
                      type="button"
                      className="ai-existing"
                      onClick={() => setShowDocuments((v) => !v)}
                    >
                      {t('Choose saved document')}
                    </button>
                  </>
                )}
              </div>
              <button
                type="button"
                className="ai-send"
                aria-label={t('Send')}
                disabled={busy || (!draft.trim() && !file && !documentId)}
                onClick={() => void send()}
              >
                <ArrowUp size={19} />
              </button>
            </div>
            {showDocuments && (
              <div className="ai-document-picker">
                <ErrorMessage error={documents.error} />
                {documents.isPending && <p>{t('Loading…')}</p>}
                {documents.data?.length === 0 && <p>{t('No scanned documents yet.')}</p>}
                {documents.data?.map((doc) => (
                  <button
                    type="button"
                    key={doc.id}
                    onClick={() => {
                      setDocumentId(doc.id);
                      setDocumentName(doc.filename);
                      setFile(null);
                      setShowDocuments(false);
                    }}
                  >
                    <FileText size={16} />
                    {doc.filename}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="ai-note">
            {t('Eliza AI can make mistakes. Check important figures and scanned documents.')}
          </p>
        </div>
      </main>
    </div>
  );
}
