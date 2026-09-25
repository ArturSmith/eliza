import { type ScaleBarcodeSettings, type TagDesign } from '@eliza/contracts';
import { Ean13Barcode } from './ean13-barcode';
import './store-settings.css';
import { t, useLanguage } from './i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, refresh } from './api';
import { Field, ErrorMessage } from './forms';
import { Button } from './components/ui/button';
type Profile = {
  scaleBarcode: ScaleBarcodeSettings;
  tagDesign: TagDesign;
  name: string;
  currency: string;
  timezone: string;
  address: string;
  phone: string;
  businessNumber: string;
  receiptFooter: string;
  defaultTaxRate: string;
  defaultMarkupPercent: string;
  version: number;
};
export function StoreSettingsPage() {
  useLanguage();
  const q = useQuery({
    queryKey: ['store-profile'],
    queryFn: () => api<Profile>('/store-profile'),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('STORE CONFIGURATION')}</div>
          <h1>{t('Store settings')}</h1>
          <p className="muted">
            {t('Business details, receipt text, and defaults for new products.')}
          </p>
        </div>
      </div>
      <ErrorMessage error={q.error} />
      {q.data ? <Editor key={q.data.version} profile={q.data} /> : <p>{t('Loading settings…')}</p>}
    </>
  );
}
function Editor({ profile }: { profile: Profile }) {
  useLanguage();
  const [value, setValue] = useState(profile),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  function updateTagDesign(patch: Partial<TagDesign>) {
    setValue((current) => ({ ...current, tagDesign: { ...current.tagDesign, ...patch } }));
  }
  async function save() {
    setBusy(true);
    try {
      await api('/store-profile', value);
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel panel-padding">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <div className="form-grid">
            {(
              [
                ['name', 'Store name'],
                ['address', 'Business address'],
                ['phone', 'Phone'],
                ['businessNumber', 'Business / tax registration number'],
                ['defaultTaxRate', 'Default tax rate (%)'],
                ['defaultMarkupPercent', 'Default selling markup (%)'],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={t(label)}>
                <input
                  required={
                    key === 'name' || key === 'defaultTaxRate' || key === 'defaultMarkupPercent'
                  }
                  value={value[key]}
                  onChange={(e) => setValue({ ...value, [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>

          <p className="muted" style={{ marginBottom: 24 }}>
            {t(
              'New product selling price = purchase cost + markup. The result includes VAT; no extra VAT is added. Existing products keep their prices.',
            )}
          </p>
          <h3>{t('Scale barcodes')}</h3>
          <p className="muted">
            {t(
              'EAN-13: two-digit prefix, product PLU, weight or price, then checksum. Match these settings to your scale. Product unit must be kilogram.',
            )}
          </p>
          <label style={{ display: 'flex', gap: 10, margin: '16px 0' }}>
            <input
              type="checkbox"
              checked={value.scaleBarcode.enabled}
              onChange={(e) =>
                setValue({
                  ...value,
                  scaleBarcode: { ...value.scaleBarcode, enabled: e.target.checked },
                })
              }
            />
            {t('Enable scale barcodes')}
          </label>
          <div className="form-grid">
            <Field label={t('Scale prefix (20–29)')}>
              <input
                required
                pattern="2[0-9]"
                value={value.scaleBarcode.prefix}
                onChange={(e) =>
                  setValue({
                    ...value,
                    scaleBarcode: { ...value.scaleBarcode, prefix: e.target.value },
                  })
                }
              />
            </Field>
            <Field label={t('Product code digits')}>
              <input
                required
                type="number"
                min={1}
                max={8}
                value={value.scaleBarcode.productDigits}
                onChange={(e) =>
                  setValue({
                    ...value,
                    scaleBarcode: { ...value.scaleBarcode, productDigits: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label={t('Encoded value')}>
              <select
                value={value.scaleBarcode.mode}
                onChange={(e) =>
                  setValue({
                    ...value,
                    scaleBarcode: {
                      ...value.scaleBarcode,
                      mode: e.target.value as 'weight' | 'price',
                      decimals: e.target.value === 'price' ? 2 : 3,
                    },
                  })
                }
              >
                <option value="weight">{t('Weight')}</option>
                <option value="price">{t('Price')}</option>
              </select>
            </Field>
            <Field label={t('Encoded decimal places')}>
              <input
                required
                type="number"
                min={0}
                max={3}
                disabled={value.scaleBarcode.mode === 'price'}
                value={value.scaleBarcode.decimals}
                onChange={(e) =>
                  setValue({
                    ...value,
                    scaleBarcode: { ...value.scaleBarcode, decimals: Number(e.target.value) },
                  })
                }
              />
            </Field>
          </div>
          <p className="muted">
            {t(
              'Price-only labels infer weight from the current price per kilogram. Keep scale prices synchronized; weight labels preserve the measured weight.',
            )}
          </p>
          <h3>{t('Price tag design')}</h3>
          <p className="muted">
            {t(
              'Set label sizes in millimeters for A4 paper. Product name and price stay visible; weight labels always show the measured weight and scannable barcode.',
            )}
          </p>
          <div className="form-grid">
            {(
              [
                ['regularWidthMm', 'Price tag width (mm)'],
                ['regularHeightMm', 'Price tag height (mm)'],
                ['weightWidthMm', 'Weight label width (mm)'],
                ['weightHeightMm', 'Weight label height (mm)'],
                ['gapMm', 'Gap between labels (mm)'],
                ['nameFontPt', 'Product name font (pt)'],
                ['priceFontPt', 'Price font (pt)'],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={t(label)}>
                <input
                  type="number"
                  required
                  min={
                    key === 'gapMm'
                      ? 0
                      : key === 'nameFontPt'
                        ? 9
                        : key === 'priceFontPt'
                          ? 14
                          : key === 'weightWidthMm'
                            ? 70
                            : key === 'weightHeightMm'
                              ? 45
                              : key === 'regularWidthMm'
                                ? 45
                                : 35
                  }
                  max={
                    key === 'gapMm'
                      ? 12
                      : key === 'nameFontPt'
                        ? 18
                        : key === 'priceFontPt'
                          ? 32
                          : key === 'weightHeightMm'
                            ? 100
                            : key === 'regularHeightMm'
                              ? 90
                              : 120
                  }
                  value={value.tagDesign[key]}
                  onChange={(event) => updateTagDesign({ [key]: Number(event.target.value) })}
                />
              </Field>
            ))}
          </div>
          <div className="tag-design-options">
            {(
              [
                ['showStoreName', 'Show store name'],
                ['showSku', 'Show SKU'],
                ['showUnit', 'Show selling unit'],
                ['showBarcodeNumber', 'Show barcode digits'],
                ['showWeightUnitPrice', 'Show price per kilogram on weight labels'],
                ['showPackagePrice', 'Show package price on weight labels'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={value.tagDesign[key]}
                  onChange={(event) => updateTagDesign({ [key]: event.target.checked })}
                />
                {t(label)}
              </label>
            ))}
          </div>
          <h4>{t('Tag preview')}</h4>
          <div className="tag-design-preview">
            <article
              style={{
                width: `${value.tagDesign.regularWidthMm}mm`,
                height: `${value.tagDesign.regularHeightMm}mm`,
              }}
            >
              {value.tagDesign.showStoreName && <small>{value.name}</small>}
              <strong style={{ fontSize: `${value.tagDesign.nameFontPt}pt` }}>
                {t('Sample product')}
              </strong>
              <b style={{ fontSize: `${value.tagDesign.priceFontPt}pt` }}>99.00 {value.currency}</b>
              {value.tagDesign.showSku && <small>SKU-001</small>}
              {value.tagDesign.showUnit && <small>{t('piece')}</small>}
              {value.tagDesign.showBarcodeNumber && <small>4601234567893</small>}
            </article>
            <article
              style={{
                width: `${value.tagDesign.weightWidthMm}mm`,
                height: `${value.tagDesign.weightHeightMm}mm`,
              }}
            >
              {value.tagDesign.showStoreName && <small>{value.name}</small>}
              <strong style={{ fontSize: `${value.tagDesign.nameFontPt}pt` }}>
                {t('Sample weight product')}
              </strong>
              {value.tagDesign.showSku && <small>SKU-002</small>}
              <span>0.500 {t('kg')}</span>
              {value.tagDesign.showWeightUnitPrice && (
                <small>
                  99.00 {value.currency}/{t('kg')}
                </small>
              )}
              {value.tagDesign.showPackagePrice && <b>49.50 {value.currency}</b>}
              <Ean13Barcode code="2000042005009" showDigits={value.tagDesign.showBarcodeNumber} />
            </article>
          </div>
          <Field label={t('Receipt footer')}>
            <textarea
              rows={3}
              value={value.receiptFooter}
              onChange={(e) => setValue({ ...value, receiptFooter: e.target.value })}
            />
          </Field>
          <p className="muted">
            {t(
              'Default tax applies to new products only. Existing product rates and old receipts remain unchanged. ',
            )}
          </p>
          <p>
            {t('Currency: ')}
            {profile.currency} {t(' · Timezone: ')}
            {profile.timezone}
          </p>
          <p className="muted">
            {t('Currency and timezone remain fixed to keep historical reporting consistent. ')}
          </p>
          <h3 style={{ marginTop: 24, marginBottom: 12 }}>{t('Receipt header preview')}</h3>
          <div style={{ whiteSpace: 'pre-wrap', padding: 20, border: '1px solid var(--border)' }}>
            <strong>{value.name}</strong>
            <div>{value.address}</div>
            <div>{value.phone}</div>
            <div>{value.businessNumber}</div>
            <p>{value.receiptFooter}</p>
          </div>
          <ErrorMessage error={error} />
          <Button style={{ marginTop: 16 }}>{t('Save store settings')}</Button>
        </fieldset>
      </form>
    </section>
  );
}
