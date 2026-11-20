import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Barcode, ChevronRight, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  maxProductPhotos,
  productSchema,
  productVariantsSchema,
  toScaled,
  units,
  type Product,
} from '@eliza/contracts';
import { api, productCatalogUpdateKey, queryClient, refresh, useProducts, useSession } from './api';
import { AdjustmentForm, ErrorMessage, Field } from './forms';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { ProductBarcode } from './product-barcode';
import { ProductSuppliers } from './supplier-products';
import { BarcodeLookup } from './barcode-lookup';
import { CameraBarcodeScanner } from './camera-barcode-scanner';
import { formatMoney } from './receipts';
import { formatQuantity } from './quantity-format';
import { prepareProductImage } from './product-image';
import { productPriceMargin } from './product-price-margin';
import {
  productDraft,
  productDraftInput,
  productDraftKey,
  productCodes,
  type ProductDraft,
} from './product-draft';
import { t, useLanguage } from './i18n';
import { ProductBatchCosts } from './product-batch-costs';
import './product-details.css';

export function ProductDetailsPage({
  create = false,
  edit = false,
}: {
  create?: boolean;
  edit?: boolean;
}) {
  useLanguage();
  const { id } = useParams({ strict: false });
  const products = useProducts();
  const session = useSession().data!;
  const product = create ? undefined : products.data?.find((p) => p.id === id);
  const canEdit = session.user.permissions.includes('catalog.write');
  if (products.isPending) return <p role="status">{t('Loading…')}</p>;
  if (products.error) return <ErrorMessage error={products.error} />;
  if ((create || edit) && !canEdit)
    return (
      <div className="empty">
        <h1>{t('Access restricted')}</h1>
        <Link to="/products">{t('Back to products')}</Link>
      </div>
    );
  if (!create && !product)
    return (
      <div className="empty">
        <h1>{t('Product not found.')}</h1>
        <Link to="/products">{t('Back to products')}</Link>
      </div>
    );
  return (
    <ProductDetailsForm
      key={create ? 'new' : id}
      product={product}
      startEditing={edit && canEdit}
    />
  );
}

function ProductDetailsForm({
  product,
  startEditing,
}: {
  product?: Product;
  startEditing: boolean;
}) {
  useLanguage();
  const creating = !product;
  const navigate = useNavigate();
  const session = useSession().data!;
  const canEdit = session.user.permissions.includes('catalog.write');
  const canReadCosts = session.user.permissions.includes('costs.read');
  const canReadSuppliers = session.user.permissions.includes('suppliers.read');
  const canAdjustStock = session.user.permissions.includes('inventory.adjust');
  const [editing, setEditing] = useState(creating || startEditing);
  const [draft, setDraft] = useState(() => productDraft(product));
  const [baseline, setBaseline] = useState(() => productDraftKey(productDraft(product)));
  const [selectedPhoto, setSelectedPhoto] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [barcode, setBarcode] = useState(false);
  const [adjustStock, setAdjustStock] = useState(false);
  const [confirmation, setConfirmation] = useState<'status' | 'delete' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [variants, setVariants] = useState<{ id: string; volume: string; barcode: string }[]>([]);
  const [created, setCreated] = useState<Product[]>([]);
  const [resetVersion, setResetVersion] = useState(0);
  const multiple = creating && variants.length > 1;
  const formId = useId();
  const profile = useQuery({
    queryKey: ['store-profile'],
    queryFn: () => api<{ defaultTaxRate: string; defaultMarkupPercent: string }>('/store-profile'),
    enabled: creating,
  });
  useEffect(() => {
    if (!editing && product) {
      const next = productDraft(product);
      setDraft(next);
      setBaseline(productDraftKey(next));
    }
  }, [product, editing]);
  const dirty = productDraftKey(draft) !== baseline;
  const save = useMutation({
    mutationFn: (body: unknown) =>
      api<Product | Product[]>(
        creating ? (multiple ? '/products/variants' : '/products') : '/products/' + product!.id,
        body,
        creating ? 'POST' : 'PATCH',
      ),
    onSuccess: async (result) => {
      const savedProducts = Array.isArray(result) ? result : [result];
      const saved = savedProducts[0];
      queryClient.setQueryData<Product[]>(['products'], (rows) =>
        rows
          ? creating
            ? [...rows, ...savedProducts]
            : rows.map((p) => (p.id === saved.id ? saved : p))
          : undefined,
      );
      const nextDraft = productDraft(creating ? undefined : saved);
      setDraft(nextDraft);
      setBaseline(productDraftKey(nextDraft));
      setEditing(creating);
      if (creating) {
        setCreated(savedProducts);
        setVariants([]);
        setSelectedPhoto(0);
        setBarcode(false);
        setResetVersion((value) => value + 1);
      }
      setError(undefined);
      try {
        localStorage.setItem(productCatalogUpdateKey, crypto.randomUUID());
      } catch {
        /* Device polling also refreshes checkout. */
      }
      void refresh();
      if (!creating && startEditing)
        await navigate({ to: '/products/$id', params: { id: saved.id }, replace: true });
    },
  });
  const action = useMutation({
    mutationFn: (kind: 'status' | 'delete') =>
      kind === 'delete'
        ? api('/products/' + product!.id, undefined, 'DELETE')
        : api('/products/' + product!.id + '/status', { active: !product!.active }, 'PATCH'),
    onSuccess: async (_, kind) => {
      setConfirmation(null);
      await refresh();
      if (kind === 'delete') await navigate({ to: '/products' });
    },
  });
  const busy = save.isPending || photoBusy || action.isPending;
  useEffect(() => {
    if (resetVersion && !busy) nameInput.current?.focus();
  }, [resetVersion, busy]);
  const locked = !editing || !canEdit || busy || (creating && profile.isPending);
  function change<K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(undefined);
  }
  function beginEditing() {
    setEditing(true);
    setError(undefined);
  }
  function cancel() {
    setDraft(productDraft(product));
    setBaseline(productDraftKey(productDraft(product)));
    setEditing(false);
    setError(undefined);
    save.reset();
    setSelectedPhoto(0);
    if (startEditing && product)
      void navigate({ to: '/products/$id', params: { id: product.id }, replace: true });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !canEdit || busy || (!creating && !dirty)) return;
    const input = productDraftInput(draft, creating ? (profile.data?.defaultTaxRate ?? '0') : '');
    const parsed = multiple
      ? productVariantsSchema.safeParse({ ...input, variants })
      : productSchema.safeParse(input);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('. '),
      );
      return;
    }
    const { cost: _legacyCost, ...catalogData } = parsed.data;
    save.mutate({
      ...catalogData,
      ...(creating ? { autoSku: !draft.sku.trim(), autoPlu: !draft.plu.trim() } : {}),
    });
  }
  async function addFiles(files: File[]) {
    if (!files.length || busy) return;
    setPhotoBusy(true);
    setError(undefined);
    try {
      if (files.length + draft.images.length > maxProductPhotos)
        throw new Error(t('You can add up to {count} photos.', { count: maxProductPhotos }));
      const images = await Promise.all(files.map(prepareProductImage));
      beginEditing();
      setDraft((current) => ({ ...current, images: [...current.images, ...images] }));
      setSelectedPhoto(draft.images.length);
    } catch (cause) {
      setError(cause);
    } finally {
      setPhotoBusy(false);
    }
  }
  const currency = session.store.currency;
  const previewInput = {
    price: draft.price,
    cost: product?.averageCost ?? null,
    taxRate: draft.taxRate || (creating ? (profile.data?.defaultTaxRate ?? '0') : ''),
  };
  const price = productSchema.shape.price.safeParse(previewInput.price);
  const cost = productSchema.shape.cost.safeParse(previewInput.cost);
  const tax = productSchema.shape.taxRate.safeParse(previewInput.taxRate);
  const margin =
    canReadCosts && price.success && cost.success && tax.success
      ? productPriceMargin({ price: price.data, cost: cost.data, taxRate: tax.data })
      : null;
  const stock = product ? toScaled(product.stock, 3) : null;
  const stockLabel = !product
    ? ''
    : !product.active
      ? t('Inactive')
      : stock! <= 0n
        ? t('Out of stock')
        : stock! <= toScaled(product.minStock, 3)
          ? t('Low stock')
          : t('In stock');
  const activePhoto = draft.images[Math.min(selectedPhoto, Math.max(0, draft.images.length - 1))];
  const controls = { form: formId, readOnly: locked, disabled: busy };
  return (
    <div className="product-details-page">
      <div className="product-details-navigation">
        <Link to="/products" className="button button-outline">
          <ArrowLeft size={16} />
          {t('Back to products')}
        </Link>
        <nav aria-label={t('Product breadcrumbs')}>
          <span>{t('Products')}</span>
          <ChevronRight size={14} />
          {draft.category && (
            <>
              <span>{draft.category}</span>
              <ChevronRight size={14} />
            </>
          )}
          <strong>{creating ? t('New product') : product!.name}</strong>
        </nav>
      </div>
      {creating && created.length > 0 && (
        <p role="status" className="notice">
          {t('Created {count} products. The form is ready for the next product.', {
            count: created.length,
          })}{' '}
          <Link to="/products/$id" params={{ id: created[0].id }}>
            {t('View product')}
          </Link>
        </p>
      )}
      <form id={formId} onSubmit={submit} hidden />
      <div className="product-details-columns">
        <div className="product-details-main">
          <section
            className="panel product-details-section product-details-general"
            aria-labelledby="product-general-heading"
          >
            <h1 id="product-general-heading">{t('General information')}</h1>
            {creating && (
              <BarcodeLookup
                key={resetVersion}
                disabled={busy || multiple}
                onBarcode={(code) =>
                  change(
                    'barcodes',
                    [...new Set([...productCodes(draft.barcodes), code])].join('\n'),
                  )
                }
                onExisting={(existing) =>
                  void navigate({ to: '/products/$id', params: { id: existing.id } })
                }
                onUse={async (suggestion) => {
                  let images = draft.images;
                  let imported = false;
                  if (!images.length && suggestion.image) {
                    setPhotoBusy(true);
                    try {
                      const blob = await (await fetch(suggestion.image)).blob();
                      images = [
                        await prepareProductImage(
                          new File([blob], 'product.jpg', { type: blob.type }),
                        ),
                      ];
                      imported = true;
                    } catch {
                      setError(
                        new Error(
                          t('Product details were filled, but the photo could not be imported.'),
                        ),
                      );
                    } finally {
                      setPhotoBusy(false);
                    }
                  }
                  setDraft((current) => ({
                    ...current,
                    name: current.name || suggestion.name,
                    description: current.description || suggestion.description || '',
                    category: current.category || suggestion.category,
                    unit: current.unit || 'piece',
                    brand: current.brand || suggestion.brand,
                    volume: current.volume || suggestion.quantity,
                    barcodes: [
                      ...new Set([...productCodes(current.barcodes), suggestion.barcode]),
                    ].join('\n'),
                    images,
                    source: {
                      barcode: suggestion.barcode,
                      brand: suggestion.brand,
                      quantity: suggestion.quantity,
                      imageImported: imported,
                    },
                  }));
                }}
              />
            )}
            <div className="product-details-fields">
              <div className="product-detail-field-wide">
                <Field label={t('Product name')}>
                  <input
                    {...controls}
                    name="name"
                    ref={nameInput}
                    value={draft.name}
                    required
                    maxLength={120}
                    onChange={(event) => change('name', event.target.value)}
                  />
                </Field>
              </div>
              <div className="product-detail-field-wide">
                <Field label={t('Description (optional)')}>
                  <textarea
                    {...controls}
                    name="description"
                    rows={4}
                    maxLength={2000}
                    value={draft.description}
                    onChange={(event) => change('description', event.target.value)}
                  />
                </Field>
              </div>
              <div className="product-detail-field-wide">
                <Field label={t('Category')}>
                  <input
                    {...controls}
                    name="category"
                    list="product-detail-categories"
                    value={draft.category}
                    required
                    maxLength={120}
                    onChange={(event) => change('category', event.target.value)}
                  />
                </Field>
                <datalist id="product-detail-categories">
                  {[
                    ...new Set(
                      queryClient.getQueryData<Product[]>(['products'])?.map((p) => p.category),
                    ),
                  ]
                    .sort()
                    .map((category) => (
                      <option key={category} value={category} />
                    ))}
                </datalist>
              </div>
              <Field
                label={t('Unit')}
                hint={
                  editing && !creating
                    ? t(
                        'Unit changes require a stock conversion workflow. Create a separate product instead.',
                      )
                    : undefined
                }
              >
                <select
                  form={formId}
                  name="unit"
                  value={draft.unit}
                  required
                  disabled={!creating || locked}
                  onChange={(event) => change('unit', event.target.value)}
                >
                  <option value="">{t('Choose a unit')}</option>
                  {units.map((unit) => (
                    <option key={unit} value={unit}>
                      {t(unit)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('Status')}>
                <output className="product-detail-value">
                  {product ? (product.active ? t('Active') : t('Inactive')) : '—'}
                </output>
              </Field>
              {!multiple && (
                <>
                  <div className="product-detail-field-wide">
                    <Field
                      label={t('Barcodes (optional)')}
                      hint={
                        editing
                          ? t(
                              'Add one per line, or separate with commas. Leave blank to generate a barcode.',
                            )
                          : undefined
                      }
                    >
                      <textarea
                        {...controls}
                        name="barcodes"
                        rows={2}
                        value={draft.barcodes}
                        onChange={(event) => change('barcodes', event.target.value)}
                      />
                    </Field>
                    <div className="product-details-barcode-actions">
                      {editing ? (
                        <CameraBarcodeScanner
                          onScan={(code) =>
                            change(
                              'barcodes',
                              [...new Set([...productCodes(draft.barcodes), code])].join('\n'),
                            )
                          }
                        />
                      ) : product?.barcodes.length ? (
                        <Button variant="ghost" size="sm" onClick={() => setBarcode(true)}>
                          <Barcode size={16} />
                          {t('View barcode')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <Field
                    label={t('SKU')}
                    hint={editing ? t('Leave blank to generate a code.') : undefined}
                  >
                    <input
                      {...controls}
                      name="sku"
                      value={draft.sku}
                      maxLength={120}
                      onChange={(event) => change('sku', event.target.value)}
                    />
                  </Field>
                  <Field
                    label={t('PLU / short code (optional)')}
                    hint={creating ? t('Leave blank to generate a code.') : undefined}
                  >
                    <input
                      {...controls}
                      name="plu"
                      value={draft.plu}
                      maxLength={20}
                      onChange={(event) => change('plu', event.target.value)}
                    />
                  </Field>
                </>
              )}
              <Field label={t('Brand (optional)')}>
                <input
                  {...controls}
                  name="brand"
                  maxLength={120}
                  value={draft.brand}
                  onChange={(event) => change('brand', event.target.value)}
                />
              </Field>
              {!multiple && (
                <Field
                  label={t('Volume / size (optional)')}
                  hint={t('For example: 330 ml, 500 ml, 1 L.')}
                >
                  <input
                    {...controls}
                    name="volume"
                    maxLength={120}
                    value={draft.volume}
                    onChange={(event) => change('volume', event.target.value)}
                  />
                </Field>
              )}
            </div>
            {creating && (
              <div className="product-volume-variants">
                {multiple && (
                  <>
                    <h2>{t('Volume variants')}</h2>
                    <p className="product-details-hint">
                      {t(
                        'Each variant creates a separate product with the shared details above. SKU and PLU are generated for each product.',
                      )}
                    </p>
                    {variants.map((variant, index) => (
                      <div className="product-volume-row" key={variant.id}>
                        <Field label={t('Volume {number}', { number: index + 1 })}>
                          <input
                            {...controls}
                            required
                            maxLength={120}
                            placeholder={t('For example: 500 ml')}
                            value={variant.volume}
                            onChange={(event) =>
                              setVariants((rows) =>
                                rows.map((row) =>
                                  row.id === variant.id
                                    ? { ...row, volume: event.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                        </Field>
                        <Field label={t('Barcode {number}', { number: index + 1 })}>
                          <input
                            {...controls}
                            required
                            maxLength={100}
                            value={variant.barcode}
                            onChange={(event) =>
                              setVariants((rows) =>
                                rows.map((row) =>
                                  row.id === variant.id
                                    ? { ...row, barcode: event.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                        </Field>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy}
                          aria-label={t('Remove variant {number}', { number: index + 1 })}
                          onClick={() => {
                            const remaining = variants.filter((row) => row.id !== variant.id);
                            if (remaining.length === 1) {
                              setDraft((current) => ({
                                ...current,
                                volume: remaining[0].volume,
                                barcodes: remaining[0].barcode,
                              }));
                              setVariants([]);
                            } else setVariants(remaining);
                            setError(undefined);
                          }}
                        >
                          <Trash2 size={18} />
                        </Button>
                      </div>
                    ))}
                  </>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || variants.length >= 50}
                  onClick={() => {
                    if (!multiple && productCodes(draft.barcodes).length > 1) {
                      setError(t('Keep one barcode for the first volume before adding variants.'));
                      return;
                    }
                    const next = { id: crypto.randomUUID(), volume: '', barcode: '' };
                    setVariants((rows) =>
                      multiple
                        ? [...rows, next]
                        : [
                            {
                              id: crypto.randomUUID(),
                              volume: draft.volume,
                              barcode: productCodes(draft.barcodes)[0] ?? '',
                            },
                            next,
                          ],
                    );
                    setError(undefined);
                  }}
                >
                  <Plus size={16} />
                  {t('Add volume variant')}
                </Button>
              </div>
            )}
          </section>
          <section
            className="panel product-details-section product-details-pricing"
            aria-labelledby="product-pricing-heading"
          >
            <h2 id="product-pricing-heading">{t('Pricing and stock')}</h2>
            <div className="product-details-fields">
              {canReadCosts && !creating && (
                <Field label={t('Average cost of remaining stock')}>
                  <output className="product-detail-value">
                    {formatMoney(product?.averageCost, currency)}
                  </output>
                </Field>
              )}
              <Field label={t('On hand')}>
                <output className="product-detail-value">
                  {product ? (
                    <>
                      {formatQuantity(product.stock)} {t(product.unit)} <small>{stockLabel}</small>
                    </>
                  ) : (
                    '—'
                  )}
                </output>
              </Field>
              <Field label={t('Selling price (optional)')}>
                <input
                  {...controls}
                  name="price"
                  inputMode="decimal"
                  value={draft.price}
                  onChange={(event) => change('price', event.target.value)}
                />
              </Field>
              {canReadCosts && !creating && (
                <Field label={t('Estimated gross margin')}>
                  <output
                    className="product-detail-value product-margin-preview"
                    aria-live="polite"
                  >
                    {margin ? (
                      <>
                        {formatQuantity(margin.percent)}%{' '}
                        <small>({formatMoney(margin.profit, currency)})</small>
                      </>
                    ) : (
                      '—'
                    )}
                  </output>
                </Field>
              )}
              <Field
                label={t('Tax rate (%)')}
                hint={
                  creating && profile.data
                    ? t('Store default: {value}%', {
                        value: formatQuantity(profile.data.defaultTaxRate),
                      })
                    : undefined
                }
              >
                <input
                  {...controls}
                  name="taxRate"
                  required={!creating}
                  inputMode="decimal"
                  value={draft.taxRate}
                  onChange={(event) => change('taxRate', event.target.value)}
                />
              </Field>
              <Field label={t('Low-stock threshold')}>
                <input
                  {...controls}
                  name="minStock"
                  required={!creating}
                  inputMode="decimal"
                  value={draft.minStock}
                  onChange={(event) => change('minStock', event.target.value)}
                />
              </Field>
            </div>
          </section>
        </div>
        <aside className="product-details-aside">
          <section className="panel product-details-section product-details-gallery">
            <h2>{t('Product photo')}</h2>
            <div className="product-details-photo">
              {activePhoto ? (
                <img
                  src={activePhoto}
                  alt={creating ? t('Product photo preview') : product!.name}
                />
              ) : (
                <Package size={72} strokeWidth={1.1} aria-label={t('No product photo')} />
              )}
            </div>
            <div className="product-photo-thumbnails" aria-label={t('Product photo gallery')}>
              {draft.images.map((image, index) => (
                <button
                  key={index}
                  type="button"
                  className="product-photo-thumbnail"
                  aria-label={t('Photo {number}', { number: index + 1 })}
                  aria-pressed={index === Math.min(selectedPhoto, draft.images.length - 1)}
                  onClick={() => setSelectedPhoto(index)}
                >
                  <img src={image} alt="" />
                </button>
              ))}
              {canEdit && draft.images.length < maxProductPhotos && (
                <button
                  type="button"
                  className="product-photo-add"
                  aria-label={t('Add photo')}
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  <Plus size={24} />
                </button>
              )}
            </div>
            {canEdit && (
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                aria-label={t('Add product photos')}
                disabled={busy}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  void addFiles(files);
                }}
              />
            )}
            {photoBusy && <p role="status">{t('Preparing photos…')}</p>}
            {editing && draft.images.length > 0 && (
              <div className="product-photo-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    change(
                      'images',
                      draft.images.filter(
                        (_, index) => index !== Math.min(selectedPhoto, draft.images.length - 1),
                      ),
                    );
                    setSelectedPhoto(0);
                  }}
                >
                  {t('Remove photo')}
                </Button>
                {selectedPhoto > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      change('images', [
                        draft.images[selectedPhoto],
                        ...draft.images.filter((_, index) => index !== selectedPhoto),
                      ]);
                      setSelectedPhoto(0);
                    }}
                  >
                    {t('Use as cover')}
                  </Button>
                )}
              </div>
            )}
            <p className="product-details-hint">
              {t('Up to {count} photos. The first photo is shown in the catalog.', {
                count: maxProductPhotos,
              })}
            </p>
            {draft.source && (
              <p className="product-details-hint">
                <a
                  href={'https://world.openfoodfacts.org/product/' + draft.source.barcode}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('Open Food Facts contributors ')}
                </a>{' '}
                {t('· ODbL')}
                {draft.source.imageImported && t(' · Photo resized, CC BY-SA 3.0')}
              </p>
            )}
          </section>
          {(canEdit || (canAdjustStock && product)) && (
            <section className="panel product-details-section product-details-actions">
              <ErrorMessage error={error ?? save.error ?? (creating ? profile.error : undefined)} />
              {canEdit && (
                <div className="product-detail-save-actions">
                  {!editing ? (
                    <Button className="full" onClick={beginEditing}>
                      <Pencil size={16} />
                      {t('Edit product')}
                    </Button>
                  ) : creating || dirty ? (
                    <Button
                      className="full"
                      type="submit"
                      form={formId}
                      disabled={busy || (creating && (profile.isPending || !!profile.error))}
                    >
                      {save.isPending
                        ? t('Saving…')
                        : creating
                          ? multiple
                            ? t('Create {count} products', { count: variants.length })
                            : t('Add product')
                          : t('Save')}
                    </Button>
                  ) : (
                    <Button className="full" variant="outline" disabled={busy} onClick={cancel}>
                      {t('Cancel')}
                    </Button>
                  )}
                  {!creating && editing && dirty && (
                    <Button className="full" variant="ghost" disabled={busy} onClick={cancel}>
                      {t('Cancel')}
                    </Button>
                  )}
                </div>
              )}
              {product && canAdjustStock && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="full"
                    disabled={busy || !product.active || (editing && dirty) || adjustStock}
                    onClick={() => setAdjustStock(true)}
                  >
                    <Plus size={16} />
                    {t('Record stock')}
                  </Button>
                  {editing && dirty && (
                    <small className="product-details-hint">
                      {t('Save product changes before recording stock.')}
                    </small>
                  )}
                </>
              )}
              {canEdit && product && !editing && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      action.reset();
                      setConfirmation('status');
                    }}
                  >
                    {product.active ? t('Deactivate') : t('Activate')}
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={t('Delete {value0}', { value0: product.name })}
                    onClick={() => {
                      action.reset();
                      setConfirmation('delete');
                    }}
                  >
                    <Trash2 size={16} />
                    {t('Delete product')}
                  </Button>
                </>
              )}
              {adjustStock && canAdjustStock && product && (
                <section className="product-stock-adjust" aria-label={t('Record stock')}>
                  <h3>{t('Record a stock adjustment')}</h3>
                  <AdjustmentForm
                    products={[product]}
                    fixedProduct={product}
                    onDone={() => setAdjustStock(false)}
                  />
                </section>
              )}
            </section>
          )}
          {canReadCosts && product && <ProductBatchCosts key={product.id} product={product} />}
          {canReadSuppliers &&
            (product ? (
              <div className="product-details-suppliers">
                <ProductSuppliers productId={product.id} unit={product.unit} />
              </div>
            ) : (
              <section className="panel product-details-section">
                <h2>{t('Suppliers')}</h2>
                <p className="muted">
                  {t('Link products from a supplier page or when recording a purchase.')}
                </p>
              </section>
            ))}
        </aside>
      </div>
      <ProductBarcode
        product={barcode && product ? product : null}
        onClose={() => setBarcode(false)}
      />
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && !action.isPending && setConfirmation(null)}
        title={
          confirmation === 'delete'
            ? t('Delete product?')
            : product?.active
              ? t('Deactivate product?')
              : t('Activate product?')
        }
        description={
          confirmation === 'delete'
            ? t(
                'Only products with zero stock and no sales, purchase, inventory, count or list history can be deleted. Deactivate products that must remain in your records.',
              )
            : product?.active
              ? t(
                  'The product remains in your records and stock history. It will be unavailable for new stock adjustments.',
                )
              : t('The product will be available for stock adjustments again.')
        }
      >
        <p className="confirm-name">{product?.name}</p>
        <ErrorMessage error={action.error} />
        <div className="form-actions">
          <Button
            variant={confirmation === 'delete' ? 'destructive' : 'default'}
            disabled={action.isPending}
            onClick={() => confirmation && action.mutate(confirmation)}
          >
            {action.isPending
              ? t('Saving…')
              : confirmation === 'delete'
                ? t('Delete product')
                : t('Confirm')}
          </Button>
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => setConfirmation(null)}
          >
            {t('Cancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
