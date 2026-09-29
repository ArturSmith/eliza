import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, refresh, useProducts } from './api';
import { Button } from './components/ui/button';
import { ErrorMessage } from './forms';
import { t, useLanguage } from './i18n';

type Promotion = {
  id: string;
  name: string;
  discountType: 'PERCENTAGE' | 'FIXED_PRICE';
  discountValue: string;
  startsAt: string;
  endsAt: string | null;
  cancelledAt: string | null;
  enabled: boolean;
  productIds: string[];
  categoryIds: string[];
};
type Category = { id: string; name: string };

export function PromotionsPage() {
  useLanguage();
  const products = useProducts();
  const categories = useQuery({
    queryKey: ['promotion-categories'],
    queryFn: () => api<Category[]>('/promotions/categories'),
  });
  const list = useQuery({
    queryKey: ['promotions'],
    queryFn: () => api<Promotion[]>('/promotions'),
  });
  const [name, setName] = useState('');
  const [type, setType] = useState<'PERCENTAGE' | 'FIXED_PRICE'>('PERCENTAGE');
  const [value, setValue] = useState('');
  const [productIds, setProductIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api('/promotions', {
        name,
        discountType: type,
        discountValue: value,
        productIds,
        categoryIds,
        ...(startsAt ? { startsAtLocal: startsAt } : {}),
        ...(endsAt ? { endsAtLocal: endsAt } : {}),
      }),
    onSuccess: () => {
      setName('');
      setValue('');
      setProductIds([]);
      setCategoryIds([]);
      setStartsAt('');
      setEndsAt('');
      void list.refetch();
      void refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/promotions/${id}/cancel`, {}),
    onSuccess: () => {
      void list.refetch();
      void refresh();
    },
  });
  function toggle(id: string, selected: string[], set: (next: string[]) => void) {
    set(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }
  return (
    <div className="page-content">
      <header className="page-heading">
        <div>
          <h1>{t('Promotions')}</h1>
          <p className="muted">
            {t(
              'Set a price rule for products or categories. The base selling price stays unchanged.',
            )}
          </p>
        </div>
      </header>
      <section className="panel" style={{ padding: 24, marginBottom: 24 }}>
        <h2>{t('Create promotion')}</h2>
        <form onSubmit={submit} className="form-grid">
          <label className="field">
            <span>{t('Name')}</span>
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>{t('Discount type')}</span>
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="PERCENTAGE">{t('Percentage off')}</option>
              <option value="FIXED_PRICE">{t('Final selling price')}</option>
            </select>
          </label>
          <label className="field">
            <span>{type === 'PERCENTAGE' ? t('Percent off') : t('Final selling price')}</span>
            <input
              required
              type="number"
              min="0"
              max={type === 'PERCENTAGE' ? '100' : undefined}
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <label className="field">
            <span>{t('Starts at (store time)')}</span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </label>
          <label className="field">
            <span>{t('Ends at (store time, optional)')}</span>
            <input
              type="datetime-local"
              min={startsAt || undefined}
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </label>
          <fieldset className="promotion-targets">
            <legend>{t('Products')}</legend>
            <div style={{ maxHeight: 210, overflowY: 'auto' }}>
              {(products.data ?? [])
                .filter((p) => !p.baseProductId)
                .map((p) => (
                  <label key={p.id} className="price-actions-choice">
                    <input
                      type="checkbox"
                      checked={productIds.includes(p.id)}
                      onChange={() => toggle(p.id, productIds, setProductIds)}
                    />
                    {p.name}
                  </label>
                ))}
            </div>
          </fieldset>
          <fieldset className="promotion-targets">
            <legend>{t('Categories')}</legend>
            <div style={{ maxHeight: 210, overflowY: 'auto' }}>
              {(categories.data ?? []).map((c) => (
                <label key={c.id} className="price-actions-choice">
                  <input
                    type="checkbox"
                    checked={categoryIds.includes(c.id)}
                    onChange={() => toggle(c.id, categoryIds, setCategoryIds)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
          <ErrorMessage error={create.error} />
          <div>
            <Button
              disabled={
                create.isPending || !name || !value || !(productIds.length || categoryIds.length)
              }
            >
              {t('Create promotion')}
            </Button>
          </div>
        </form>
      </section>
      <section className="panel" style={{ padding: 24 }}>
        <h2>{t('Promotion rules')}</h2>
        <ErrorMessage error={list.error ?? cancel.error} />
        {(list.data ?? []).map((p) => (
          <div key={p.id} className="cash-history-row">
            <span>
              <strong>{p.name}</strong>
              <small>
                {p.discountType === 'PERCENTAGE' ? `${p.discountValue}%` : p.discountValue}
                {' · '}
                {p.productIds.length} {t('products')}, {p.categoryIds.length} {t('categories')}
                {' · '}
                {p.cancelledAt
                  ? t('Cancelled')
                  : p.endsAt && new Date(p.endsAt) <= new Date()
                    ? t('Ended')
                    : new Date(p.startsAt) > new Date()
                      ? t('Scheduled')
                      : t('Active')}
              </small>
            </span>
            {!p.cancelledAt && (
              <Button
                type="button"
                variant="outline"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(p.id)}
              >
                {t('Cancel promotion')}
              </Button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
