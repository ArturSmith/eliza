import { UnitMarkdowns } from './unit-markdowns';
import { canManageUnitMarkdowns } from './promotions-access';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, refresh, useProducts, useSession } from './api';
import { Button } from './components/ui/button';
import { ErrorMessage } from './forms';
import { getLocale, t, useLanguage } from './i18n';
import './promotions.css';

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
type Scope = 'products' | 'categories';

export function PromotionsPage() {
  useLanguage();
  const session = useSession();
  const products = useProducts();
  const permissions = session.data?.user.permissions ?? [];
  const canPromote = permissions.includes('promotions.manage');
  const canMarkdown = canManageUnitMarkdowns(permissions);
  const [section, setSection] = useState<'promotions' | 'markdowns'>(
    canPromote ? 'promotions' : 'markdowns',
  );
  const categories = useQuery({
    queryKey: ['promotion-categories'],
    queryFn: () => api<Category[]>('/promotions/categories'),
    enabled: canPromote,
  });
  const list = useQuery({
    queryKey: ['promotions'],
    queryFn: () => api<Promotion[]>('/promotions'),
    enabled: canPromote,
  });
  const [scope, setScope] = useState<Scope>('products');
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'PERCENTAGE' | 'FIXED_PRICE'>('PERCENTAGE');
  const [value, setValue] = useState('');
  const [productIds, setProductIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [timing, setTiming] = useState<'now' | 'later'>('now');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const allProducts = (products.data ?? []).filter(
    (product) => product.active && !product.baseProductId,
  );
  const searchTerm = search.trim().toLocaleLowerCase();
  const matchingProducts = allProducts.filter((product) =>
    (product.name + ' ' + product.sku).toLocaleLowerCase().includes(searchTerm),
  );
  const matchingCategories = (categories.data ?? []).filter((category) =>
    category.name.toLocaleLowerCase().includes(searchTerm),
  );
  const selectedCount = scope === 'products' ? productIds.length : categoryIds.length;
  const validValue =
    value !== '' &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0 &&
    (type === 'FIXED_PRICE' || (Number(value) > 0 && Number(value) <= 100));
  const canCreate =
    canPromote &&
    name.trim() &&
    selectedCount > 0 &&
    validValue &&
    (timing === 'now' || !!startsAt);
  const currency = session.data?.store.currency ?? 'NOK';
  const money = (amount: string | null) =>
    amount === null
      ? '—'
      : new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(Number(amount));
  const date = (value: string) =>
    new Intl.DateTimeFormat(getLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: session.data?.store.timezone,
    }).format(new Date(value));
  const create = useMutation({
    mutationFn: () =>
      api('/promotions', {
        name: name.trim(),
        discountType: type,
        discountValue: value,
        productIds: scope === 'products' ? productIds : [],
        categoryIds: scope === 'categories' ? categoryIds : [],
        ...(timing === 'later' ? { startsAtLocal: startsAt } : {}),
        ...(endsAt ? { endsAtLocal: endsAt } : {}),
      }),
    onSuccess: () => {
      setName('');
      setValue('');
      setProductIds([]);
      setCategoryIds([]);
      setStartsAt('');
      setEndsAt('');
      setTiming('now');
      setSearch('');
      void list.refetch();
      void refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api('/promotions/' + id + '/cancel', {}),
    onSuccess: () => {
      void list.refetch();
      void refresh();
    },
  });
  function changeScope(next: Scope) {
    setScope(next);
    setSearch('');
    setProductIds([]);
    setCategoryIds([]);
  }
  function toggle(id: string, selected: string[], set: (next: string[]) => void) {
    set(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (canCreate && !create.isPending) create.mutate();
  }
  function targets(promotion: Promotion) {
    const names = [
      ...promotion.productIds
        .map((id) => allProducts.find((product) => product.id === id)?.name)
        .filter(Boolean),
      ...promotion.categoryIds
        .map((id) => categories.data?.find((category) => category.id === id)?.name)
        .filter(Boolean),
    ];
    return names.length ? names.join(', ') : t('Targets unavailable');
  }
  function status(promotion: Promotion) {
    if (promotion.cancelledAt) return 'Cancelled';
    if (!promotion.enabled || (promotion.endsAt && new Date(promotion.endsAt) <= new Date()))
      return 'Ended';
    if (new Date(promotion.startsAt) > new Date()) return 'Scheduled';
    return 'Active';
  }
  return (
    <div className="page-content promotions-page">
      <header className="page-heading">
        <div>
          <h1>{t('Promotions')}</h1>
          <p className="muted">
            {t(
              'Manage product and category promotions and individual unit markdowns in one place.',
            )}
          </p>
        </div>
      </header>
      <div className="discount-workspace-tabs" role="tablist" aria-label={t('Discount management')}>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'promotions'}
          disabled={!canPromote}
          onClick={() => setSection('promotions')}
        >
          {t('Product and category promotions')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'markdowns'}
          disabled={!canMarkdown}
          onClick={() => setSection('markdowns')}
        >
          {t('Unit markdowns')}
        </button>
      </div>
      {canMarkdown && (
        <div hidden={section !== 'markdowns'}>
          <UnitMarkdowns
            products={allProducts.filter((product) =>
              ['piece', 'pack', 'box'].includes(product.unit),
            )}
            currency={currency}
            loading={products.isPending}
            error={products.error}
          />
        </div>
      )}
      <div hidden={section !== 'promotions' || !canPromote}>
        <form onSubmit={submit} className="promotion-editor panel">
          <div className="promotion-editor-heading">
            <h2>{t('Create promotion')}</h2>
            <p className="muted">
              {t('Choose who gets the discount, set the offer, then choose when it runs.')}
            </p>
          </div>
          <section
            className="promotion-step promotion-target-step"
            aria-labelledby="promotion-target-heading"
          >
            <div className="promotion-step-title">
              <span>1</span>
              <h3 id="promotion-target-heading">{t('Who gets the discount?')}</h3>
            </div>
            <div className="promotion-segmented" role="radiogroup" aria-label={t('Apply to')}>
              <label className={scope === 'products' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="promotion-scope"
                  checked={scope === 'products'}
                  onChange={() => changeScope('products')}
                />
                {t('Specific products')}
              </label>
              <label className={scope === 'categories' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="promotion-scope"
                  checked={scope === 'categories'}
                  onChange={() => changeScope('categories')}
                />
                {t('Entire categories')}
              </label>
            </div>
            <label className="field promotion-search">
              <span>{scope === 'products' ? t('Find products') : t('Find categories')}</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={
                  scope === 'products' ? t('Search by name or SKU…') : t('Search categories…')
                }
              />
            </label>
            <div className="promotion-target-count">
              <strong>{selectedCount}</strong>{' '}
              {scope === 'products' ? t('products selected') : t('categories selected')}
            </div>
            <div className="promotion-target-list">
              {scope === 'products'
                ? matchingProducts.map((product) => (
                    <label key={product.id} className="promotion-target-row">
                      <input
                        type="checkbox"
                        checked={productIds.includes(product.id)}
                        onChange={() => toggle(product.id, productIds, setProductIds)}
                      />
                      <span>
                        <strong>{product.name}</strong>
                        <small>
                          {product.sku} · {money(product.price)}
                        </small>
                      </span>
                    </label>
                  ))
                : matchingCategories.map((category) => (
                    <label key={category.id} className="promotion-target-row">
                      <input
                        type="checkbox"
                        checked={categoryIds.includes(category.id)}
                        onChange={() => toggle(category.id, categoryIds, setCategoryIds)}
                      />
                      <span>
                        <strong>{category.name}</strong>
                      </span>
                    </label>
                  ))}
              {(scope === 'products' ? matchingProducts.length : matchingCategories.length) ===
                0 && <p className="muted promotion-empty">{t('No matches found.')}</p>}
            </div>
            {selectedCount > 0 && (
              <p className="promotion-selection-note">
                {t('Selected targets stay included when you search again.')}
              </p>
            )}
          </section>
          <div className="promotion-settings">
            <section className="promotion-step" aria-labelledby="promotion-price-heading">
              <div className="promotion-step-title">
                <span>2</span>
                <h3 id="promotion-price-heading">{t('What is the offer?')}</h3>
              </div>
              <div className="promotion-fields">
                <label className="field">
                  <span>{t('Discount type')}</span>
                  <select
                    value={type}
                    onChange={(event) => setType(event.target.value as typeof type)}
                  >
                    <option value="PERCENTAGE">{t('Percentage off')}</option>
                    <option value="FIXED_PRICE">{t('Final selling price')}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{type === 'PERCENTAGE' ? t('Percent off') : t('Final selling price')}</span>
                  <input
                    required
                    type="number"
                    min={type === 'PERCENTAGE' ? '0.01' : '0'}
                    max={type === 'PERCENTAGE' ? '100' : undefined}
                    step="0.01"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder={type === 'PERCENTAGE' ? '10' : '60.00'}
                  />
                </label>
              </div>
              <p className="muted">
                {type === 'PERCENTAGE'
                  ? t('The discount is calculated from each product’s regular price.')
                  : t('This final price applies only where it is lower than the regular price.')}
              </p>
            </section>
            <section className="promotion-step" aria-labelledby="promotion-time-heading">
              <div className="promotion-step-title">
                <span>3</span>
                <h3 id="promotion-time-heading">{t('When should it run?')}</h3>
              </div>
              <div className="promotion-timing-choice">
                <label>
                  <input
                    type="radio"
                    name="promotion-timing"
                    checked={timing === 'now'}
                    onChange={() => setTiming('now')}
                  />
                  {t('Start now')}
                </label>
                <label>
                  <input
                    type="radio"
                    name="promotion-timing"
                    checked={timing === 'later'}
                    onChange={() => setTiming('later')}
                  />
                  {t('Schedule for later')}
                </label>
              </div>
              {timing === 'later' && (
                <label className="field">
                  <span>{t('Starts at (store time)')}</span>
                  <input
                    required
                    type="datetime-local"
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </label>
              )}
              <label className="field">
                <span>{t('Ends at (store time, optional)')}</span>
                <input
                  type="datetime-local"
                  min={timing === 'later' ? startsAt || undefined : undefined}
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
              </label>
              <p className="muted">
                {t('Leave the end empty to keep the promotion active until you cancel it.')}
              </p>
            </section>
            <section className="promotion-save">
              <label className="field">
                <span>{t('Promotion name')}</span>
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('For example: Weekend dairy sale')}
                />
              </label>
              <p className="muted">
                {t(
                  'The regular price stays unchanged. If several offers apply, checkout uses the lowest price.',
                )}
              </p>
              <ErrorMessage error={create.error} />
              <Button disabled={!canCreate || create.isPending}>
                {create.isPending ? t('Saving…') : t('Create promotion')}
              </Button>
            </section>
          </div>
        </form>
        <section className="panel promotion-list">
          <div className="promotion-list-heading">
            <div>
              <h2>{t('Promotions')}</h2>
              <p className="muted">{t('Review active, scheduled and past offers.')}</p>
            </div>
            <span>
              {(list.data ?? []).filter((promotion) => status(promotion) === 'Active').length}{' '}
              {t('active')}
            </span>
          </div>
          <ErrorMessage error={list.error ?? cancel.error} />
          {!list.isPending && !list.data?.length && (
            <p className="muted promotion-empty">{t('No promotions yet.')}</p>
          )}
          <div className="promotion-list-items">
            {(list.data ?? []).map((promotion) => {
              const state = status(promotion);
              return (
                <article key={promotion.id} className="promotion-record">
                  <div className="promotion-record-main">
                    <span className={'promotion-status promotion-status-' + state.toLowerCase()}>
                      {t(state)}
                    </span>
                    <div>
                      <h3>{promotion.name}</h3>
                      <p>{targets(promotion)}</p>
                    </div>
                  </div>
                  <div className="promotion-record-meta">
                    <strong>
                      {promotion.discountType === 'PERCENTAGE'
                        ? promotion.discountValue + '% ' + t('off')
                        : money(promotion.discountValue)}
                    </strong>
                    <small>
                      {date(promotion.startsAt)}
                      {promotion.endsAt ? ' – ' + date(promotion.endsAt) : ' · ' + t('No end date')}
                    </small>
                  </div>
                  {state === 'Active' || state === 'Scheduled' ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(promotion.id)}
                    >
                      {t('Cancel promotion')}
                    </Button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
