import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { Product } from '@eliza/contracts';
import { t, useLanguage } from './i18n';
import { PriceActions } from './price-actions';
import { ErrorMessage } from './forms';
import { formatMoney } from './receipts';

export function UnitMarkdowns({
  products,
  currency,
  loading,
  error,
}: {
  products: Product[];
  currency: string;
  loading: boolean;
  error: unknown;
}) {
  useLanguage();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const picker = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !picker.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
  useEffect(() => {
    if (open && highlighted >= 0)
      document.getElementById(listId + '-' + highlighted)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted, listId]);
  function showProducts() {
    if (!open) {
      setSearch('');
      setHighlighted(-1);
      setOpen(true);
    }
  }
  function choose(product: Product) {
    // The only path to selection: explicit option click or keyboard confirmation.
    setSelectedId(product.id);
    setSearch('');
    setHighlighted(-1);
    setOpen(false);
    input.current?.focus({ preventScroll: true });
  }

  const selected = products.find((product) => product.id === selectedId);
  const text = search.trim().toLocaleLowerCase();
  const matches = products.filter((product) =>
    [product.name, product.sku, product.plu, ...product.barcodes].some((value) =>
      value?.toLocaleLowerCase().includes(text),
    ),
  );
  return (
    <section className="unit-markdown-workspace" aria-label={t('Unit markdowns')}>
      <div className="panel unit-markdown-picker">
        <h2>{t('Choose a product to mark down')}</h2>
        <p className="muted">
          {t(
            'Reduce the price of a selected number of physical items. Each item gets its own barcode; other units keep their current price.',
          )}
        </p>
        <fieldset disabled={busy}>
          <div className="unit-markdown-combobox" ref={picker}>
            <label className="field" htmlFor={listId + '-input'}>
              <span>{t('Find a product for markdown')}</span>
            </label>
            <div className="field unit-markdown-search-row">
              <input
                ref={input}
                id={listId + '-input'}
                type="search"
                role="combobox"
                autoComplete="off"
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={
                  open && matches[highlighted] ? listId + '-' + highlighted : undefined
                }
                value={open ? search : (selected?.name ?? search)}
                onFocus={showProducts}
                onClick={showProducts}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSelectedId('');
                  setHighlighted(-1);
                  setOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setOpen(false);
                    setHighlighted(-1);
                    return;
                  }
                  if (event.key === 'Tab') {
                    setOpen(false);
                    return;
                  }
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (!open) {
                      showProducts();
                      return;
                    }
                    if (matches.length)
                      setHighlighted((index) =>
                        event.key === 'ArrowDown'
                          ? (index + 1) % matches.length
                          : index <= 0
                            ? matches.length - 1
                            : index - 1,
                      );
                  }
                  if (event.key === 'Enter' && open) {
                    event.preventDefault();
                    if (matches[highlighted]) choose(matches[highlighted]);
                    else {
                      const exact = products.filter((product) =>
                        product.barcodes.includes(search.trim()),
                      );
                      if (search.trim() && exact.length === 1) choose(exact[0]);
                    }
                  }
                }}
                placeholder={t('Name, SKU, PLU or barcode')}
              />
              <button
                type="button"
                className="unit-markdown-show-products"
                aria-label={t('Show available products')}
                aria-expanded={open}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => (open ? setOpen(false) : showProducts())}
              >
                <ChevronDown size={20} aria-hidden="true" />
              </button>
            </div>
            {open && (
              <div className="unit-markdown-dropdown">
                {loading && <p role="status">{t('Loading products…')}</p>}
                <div
                  id={listId}
                  className="unit-markdown-products"
                  role="listbox"
                  aria-label={t('Product for unit markdown')}
                >
                  {matches.map((product, index) => (
                    <button
                      key={product.id}
                      id={listId + '-' + index}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={selectedId === product.id}
                      className={
                        'unit-markdown-option' + (highlighted === index ? ' highlighted' : '')
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(product)}
                    >
                      <span>
                        <strong>{product.name}</strong>
                        <small>
                          {product.sku} ·{' '}
                          {product.price === null
                            ? t('Not set')
                            : formatMoney(product.price, currency)}
                        </small>
                      </span>
                      {selectedId === product.id && <Check size={18} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
                {!loading && !matches.length && (
                  <p className="promotion-empty muted">{t('No matches found.')}</p>
                )}
              </div>
            )}
          </div>
          <ErrorMessage error={error} />
          {selected && (
            <div className="unit-markdown-selection">
              <strong>{selected.name}</strong>
              <small>
                {selected.sku} ·{' '}
                {selected.price === null ? t('Not set') : formatMoney(selected.price, currency)}
              </small>
            </div>
          )}
        </fieldset>
        <p className="muted">
          {t(
            'Unit markdowns require an active product sold as pieces, packs or boxes with a selling price. Stock availability is checked after selection.',
          )}
        </p>
      </div>
      <div className="panel unit-markdown-settings">
        {selected ? (
          <>
            <h2>{selected.name}</h2>
            <PriceActions
              key={selected.id}
              product={selected}
              currency={currency}
              embedded
              onBusyChange={setBusy}
            />
          </>
        ) : (
          <div className="unit-markdown-empty">
            <h2>{t('Select a product to continue')}</h2>
            <p className="muted">
              {t(
                'Then set the final selling price and the number of items to create individual markdown labels.',
              )}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
