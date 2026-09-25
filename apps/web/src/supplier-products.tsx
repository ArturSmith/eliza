import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  type Supplier,
  type SupplierProduct,
  type Product,
  supplierProductSchema,
} from '@eliza/contracts';
import { api, queryClient, useSession } from './api';
import { Field, ErrorMessage, SearchSelect } from './forms';
import { Dialog } from './components/ui/dialog';
import { Button } from './components/ui/button';
import { formatMoney } from './receipts';
import { t, useLanguage } from './i18n';

export type Offer = SupplierProduct & { cheapest: boolean; premiumPercent: number | null };

const invalidate = () => {
  void queryClient.invalidateQueries({ queryKey: ['supplier-products'] });
  void queryClient.invalidateQueries({ queryKey: ['product-suppliers'] });
  void queryClient.invalidateQueries({ queryKey: ['supplier-catalog'] });
};

/** Quoted unit price, or a clear gap rather than a zero that looks like free. */
function Price({ value, currency }: { value: string | null | undefined; currency: string }) {
  useLanguage();
  // Guards undefined as well as null: a missing field should read as "no price",
  // never crash the page.
  if (value === null || value === undefined) return <span className="muted">{t('No price')}</span>;
  return <>{formatMoney(value, currency)}</>;
}

/**
 * A quote that the last delivery contradicts is worth surfacing: it usually means
 * the supplier raised the price without the catalogue being updated.
 */
function staleQuote(offer: Offer) {
  if (!offer.unitCost || !offer.lastPaidCost) return false;
  const quoted = Number(offer.unitCost);
  const paid = Number(offer.lastPaidCost);
  if (!quoted) return false;
  return Math.abs(paid - quoted) / quoted > 0.03;
}

export function OfferDialog({
  open,
  onClose,
  offer,
  fixedProductId,
  fixedSupplierId,
}: {
  open: boolean;
  onClose: () => void;
  offer?: Offer;
  fixedProductId?: string;
  fixedSupplierId?: string;
}) {
  useLanguage();
  const session = useSession().data!;
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<Supplier[]>('/suppliers'),
    enabled: open,
  });
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => api<Product[]>('/products'),
    enabled: open,
  });
  const [supplierId, setSupplierId] = useState(offer?.supplierId ?? fixedSupplierId ?? '');
  const [productId, setProductId] = useState(offer?.productId ?? fixedProductId ?? '');
  const [supplierSku, setSupplierSku] = useState(offer?.supplierSku ?? '');
  const [packSize, setPackSize] = useState(offer?.packSize ?? '1');
  const [packCost, setPackCost] = useState(offer?.packCost ?? '');
  const [leadTime, setLeadTime] = useState(offer?.leadTimeDays?.toString() ?? '');
  const [error, setError] = useState<unknown>(null);
  const mutation = useMutation({
    mutationFn: (body: unknown) => api('/supplier-products', body),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: setError,
  });
  const preview =
    packCost && Number(packSize) > 0
      ? formatMoney(
          (Math.round((Number(packCost) / Number(packSize)) * 10000) / 10000).toFixed(4),
          session.store.currency,
        )
      : null;
  return (
    <Dialog
      elevated
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={offer ? t('Edit supplier price') : t('Add supplier price')}
      description={t('Record what this supplier charges so prices can be compared.')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const parsed = supplierProductSchema.safeParse({
            supplierId,
            productId,
            supplierSku,
            packSize,
            packCost,
            leadTimeDays: leadTime === '' ? null : Number(leadTime),
          });
          if (!parsed.success) {
            setError(parsed.error.issues.map((i) => i.message).join('; '));
            return;
          }
          mutation.mutate({
            ...parsed.data,
            requestId: crypto.randomUUID(),
            ...(offer ? { id: offer.id, version: offer.version } : {}),
          });
        }}
      >
        {!fixedSupplierId && (
          <SearchSelect
            label={t('Supplier')}
            placeholder={t('Choose supplier…')}
            value={
              suppliers.data?.find((s) => s.id === supplierId)
                ? {
                    title: suppliers.data.find((s) => s.id === supplierId)!.name,
                    subtitle: suppliers.data.find((s) => s.id === supplierId)!.code,
                  }
                : undefined
            }
            onSelect={setSupplierId}
            options={(suppliers.data ?? [])
              .filter((s) => s.active)
              .map((s) => ({
                id: s.id,
                title: s.name,
                subtitle: s.code,
                keywords: [s.name, s.code],
              }))}
          />
        )}
        {!fixedProductId && (
          <SearchSelect
            label={t('Product')}
            placeholder={t('Choose product…')}
            value={
              products.data?.find((p) => p.id === productId)
                ? {
                    title: products.data.find((p) => p.id === productId)!.name,
                    subtitle: products.data.find((p) => p.id === productId)!.sku,
                  }
                : undefined
            }
            onSelect={setProductId}
            options={(products.data ?? [])
              .filter((p) => p.active)
              .map((p) => ({
                id: p.id,
                title: p.name,
                subtitle: p.sku,
                keywords: [p.name, p.sku],
              }))}
          />
        )}
        <Field
          label={t('Supplier item code')}
          hint={t('Optional. The code you quote when ordering.')}
        >
          <input
            value={supplierSku}
            onChange={(e) => setSupplierSku(e.target.value)}
            maxLength={60}
          />
        </Field>
        <div className="field-row">
          <Field
            label={t('Units per pack')}
            hint={t('Use 1 if the price is already per selling unit.')}
          >
            <input
              inputMode="decimal"
              required
              value={packSize}
              onChange={(e) => setPackSize(e.target.value)}
            />
          </Field>
          <Field label={t('Price per pack')} hint={t('Excluding tax.')}>
            <input
              inputMode="decimal"
              required
              value={packCost}
              onChange={(e) => setPackCost(e.target.value)}
            />
          </Field>
        </div>
        {preview && (
          <p className="notice">
            {t('Works out to')} <strong>{preview}</strong> {t('per selling unit.')}
          </p>
        )}
        <Field label={t('Lead time in days')} hint={t('Optional.')}>
          <input
            inputMode="numeric"
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
          />
        </Field>
        <ErrorMessage error={error ?? mutation.error} />
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            {t('Cancel ')}
          </Button>
          <Button disabled={mutation.isPending}>
            {mutation.isPending ? t('Saving…') : t('Save price')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Supplier comparison for one product, cheapest per selling unit first. */
export function ProductSuppliers({ productId, unit }: { productId: string; unit: string }) {
  useLanguage();
  const session = useSession().data!;
  const currency = session.store.currency;
  const canManage = session.user.permissions.includes('suppliers.manage');
  const [editing, setEditing] = useState<Offer | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ['product-suppliers', productId],
    queryFn: () => api<Offer[]>(`/products/${productId}/suppliers`),
  });
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{t('Suppliers for this product')}</h2>
        <p>{t('Ranked by price per selling unit, so pack sizes compare fairly.')}</p>
        {canManage && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            {t('Add supplier price')}
          </Button>
        )}
      </div>
      <ErrorMessage error={q.error} />
      {q.isPending ? (
        <p className="panel-padding muted">{t('Loading…')}</p>
      ) : q.data?.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('Supplier')}</th>
                <th>{t('Pack')}</th>
                <th>{t('Per {value0}', { value0: t(unit) })}</th>
                <th>{t('Last paid')}</th>
                <th>{t('Lead time')}</th>
                {canManage && <th>{t('Actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {q.data.map((offer) => (
                <tr key={offer.id} className={offer.cheapest ? 'offer-cheapest' : undefined}>
                  <td>
                    <strong>{offer.supplierName}</strong>
                    {offer.supplierSku && <small>{offer.supplierSku}</small>}
                    {offer.cheapest && q.data.length > 1 && (
                      <span className="badge badge-green">{t('Cheapest')}</span>
                    )}
                  </td>
                  <td>
                    {formatMoney(offer.packCost, currency)}
                    <small>
                      {Number(offer.packSize)} × {t(offer.unit)}
                    </small>
                  </td>
                  <td className="numeric">
                    <Price value={offer.unitCost} currency={currency} />
                    {offer.premiumPercent !== null && offer.premiumPercent > 0 && (
                      <small className="delta-bad">
                        +{offer.premiumPercent.toFixed(1)}% {t('more')}
                      </small>
                    )}
                  </td>
                  <td className="numeric">
                    {!offer.lastPaidCost ? (
                      <span className="muted">{t('Never ordered')}</span>
                    ) : (
                      <>
                        {formatMoney(offer.lastPaidCost, currency)}
                        {staleQuote(offer) && (
                          <small className="delta-bad">{t('Differs from quote')}</small>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    {offer.leadTimeDays === null
                      ? '—'
                      : t('{value0} days', { value0: offer.leadTimeDays })}
                  </td>
                  {canManage && (
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(offer)}>
                        {t('Edit ')}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="panel-padding muted">
          {t('No supplier prices recorded for this product yet.')}
        </p>
      )}
      {(adding || editing) && (
        <OfferDialog
          open
          offer={editing}
          fixedProductId={productId}
          onClose={() => {
            setAdding(false);
            setEditing(undefined);
          }}
        />
      )}
    </section>
  );
}

/** What one supplier can supply. */
export function SupplierCatalog({ supplierId }: { supplierId: string }) {
  useLanguage();
  const session = useSession().data!;
  const currency = session.store.currency;
  const canManage = session.user.permissions.includes('suppliers.manage');
  const [editing, setEditing] = useState<Offer | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['supplier-catalog', supplierId],
    queryFn: () => api<Offer[]>(`/suppliers/${supplierId}/products`),
  });
  const rows = (q.data ?? []).filter((o) =>
    [o.productName, o.sku, o.supplierSku].some((v) =>
      v?.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{t('Products from this supplier')}</h2>
        <p>{t('What you can order, and what it costs per selling unit.')}</p>
        {canManage && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            {t('Add product')}
          </Button>
        )}
      </div>
      <ErrorMessage error={q.error} />
      {q.data && q.data.length > 3 && (
        <div className="panel-padding">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Search products…')}
            aria-label={t('Search products…')}
          />
        </div>
      )}
      {q.isPending ? (
        <p className="panel-padding muted">{t('Loading…')}</p>
      ) : rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('Product')}</th>
                <th>{t('Pack')}</th>
                <th>{t('Per unit')}</th>
                <th>{t('Last paid')}</th>
                {canManage && <th>{t('Actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((offer) => (
                <tr key={offer.id}>
                  <td>
                    <strong>{offer.productName}</strong>
                    <small>{offer.supplierSku || offer.sku}</small>
                  </td>
                  <td>
                    {formatMoney(offer.packCost, currency)}
                    <small>
                      {Number(offer.packSize)} × {t(offer.unit)}
                    </small>
                  </td>
                  <td className="numeric">
                    <Price value={offer.unitCost} currency={currency} />
                  </td>
                  <td className="numeric">
                    {!offer.lastPaidCost ? (
                      <span className="muted">{t('Never ordered')}</span>
                    ) : (
                      <>
                        {formatMoney(offer.lastPaidCost, currency)}
                        {staleQuote(offer) && (
                          <small className="delta-bad">{t('Differs from quote')}</small>
                        )}
                      </>
                    )}
                  </td>
                  {canManage && (
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(offer)}>
                        {t('Edit ')}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="panel-padding muted">
          {q.data?.length
            ? t('No products match your search.')
            : t('No products linked to this supplier yet.')}
        </p>
      )}
      {(adding || editing) && (
        <OfferDialog
          open
          offer={editing}
          fixedSupplierId={supplierId}
          onClose={() => {
            setAdding(false);
            setEditing(undefined);
          }}
        />
      )}
    </section>
  );
}
