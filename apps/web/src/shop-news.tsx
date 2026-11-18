import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Newspaper, Plus } from 'lucide-react';
import { api, queryClient } from './api';
import { Button } from './components/ui/button';
import { ErrorMessage, Field } from './forms';
import { t, useLanguage, getLocale } from './i18n';
import './shop-news.css';
type Post = {
  id: string;
  title: string;
  body: string;
  published: boolean;
  publishedAt: string | null;
  version: number;
  createdAt: string;
};
const empty = { title: '', body: '', published: false };
export function ShopNewsPage() {
  useLanguage();
  const [offset, setOffset] = useState(0),
    [editing, setEditing] = useState<Post | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['shop-news', offset],
    queryFn: () => api<{ items: Post[]; hasMore: boolean }>('/shop-news?offset=' + offset),
  });
  return (
    <div className="page-content shop-news-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('CUSTOMER RELATIONSHIPS')}</div>
          <h1>{t('Shop news')}</h1>
          <p className="muted">{t('Publish shop updates to the news feed in the customer app.')}</p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus size={18} />
          {t('New post')}
        </Button>
      </div>
      {editing && (
        <NewsEditor
          key={typeof editing === 'string' ? 'new' : editing.id}
          post={editing === 'new' ? undefined : editing}
          close={() => setEditing(null)}
        />
      )}
      <ErrorMessage error={q.error} />
      {q.isPending ? (
        <p>{t('Loading…')}</p>
      ) : (
        q.data && (
          <>
            <div className="shop-news-grid">
              {q.data.items.map((post) => (
                <article className="card shop-news-item" key={post.id}>
                  <div className="shop-news-meta">
                    <Newspaper size={20} />
                    <span>{post.published ? t('Published') : t('Draft')}</span>
                    <time>
                      {new Date(post.publishedAt ?? post.createdAt).toLocaleDateString(getLocale())}
                    </time>
                  </div>
                  <h2>{post.title}</h2>
                  <p>{post.body}</p>
                  <Button variant="outline" onClick={() => setEditing(post)}>
                    {t('Edit post')}
                  </Button>
                </article>
              ))}
            </div>
            {!q.data.items.length && (
              <p className="card shop-news-empty">
                {t('No news posts yet. Create your first update for customers.')}
              </p>
            )}
            <div className="shop-news-pagination">
              <Button
                variant="outline"
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                {t('Previous')}
              </Button>
              <Button
                variant="outline"
                disabled={!q.data.hasMore}
                onClick={() => setOffset(offset + 20)}
              >
                {t('Next')}
              </Button>
            </div>
          </>
        )
      )}
    </div>
  );
}
function NewsEditor({ post, close }: { post?: Post; close: () => void }) {
  const [value, setValue] = useState(post ?? empty);
  const mutation = useMutation({
    mutationFn: () =>
      api(post ? '/shop-news/' + post.id : '/shop-news', value, post ? 'PUT' : 'POST'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['shop-news'] });
      close();
    },
  });
  return (
    <form
      className="card shop-news-editor"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <h2>{post ? t('Edit post') : t('New post')}</h2>
      <Field label="News title">
        <input
          required
          maxLength={120}
          value={value.title}
          onChange={(e) => setValue({ ...value, title: e.target.value })}
        />
      </Field>
      <Field label="News text">
        <textarea
          required
          rows={6}
          maxLength={4000}
          value={value.body}
          onChange={(e) => setValue({ ...value, body: e.target.value })}
        />
      </Field>
      <label className="shop-news-toggle">
        <input
          type="checkbox"
          checked={value.published}
          onChange={(e) => setValue({ ...value, published: e.target.checked })}
        />
        {t('Publish to customer app')}
      </label>
      <p className="muted">
        {t('Published posts appear in the customer app. Uncheck to return a post to drafts.')}
      </p>
      <ErrorMessage error={mutation.error} />
      <div className="shop-news-actions">
        <Button disabled={mutation.isPending}>
          {mutation.isPending ? t('Saving…') : t('Save post')}
        </Button>
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={close}>
          {t('Cancel')}
        </Button>
      </div>
    </form>
  );
}
