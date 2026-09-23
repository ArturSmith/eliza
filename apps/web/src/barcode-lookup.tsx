import { t, useLanguage } from './i18n';
import { useState } from 'react';
import type { Product } from '@eliza/contracts';
import { api } from './api';
import { Button } from './components/ui/button';
import { CameraBarcodeScanner } from './camera-barcode-scanner';
import { Field, ErrorMessage } from './forms';
type Suggestion = {
  barcode: string;
  name: string;
  description?: string;
  brand: string;
  quantity: string;
  category: string;
  image: string;
};
type Result = { existing?: { id: string; name: string }; suggestion?: Suggestion | null };
export function BarcodeLookup({
  onBarcode,
  onUse,
  onExisting,
}: {
  onBarcode: (value: string) => void;
  onUse: (value: Suggestion) => Promise<void>;
  onExisting: (product: Product) => void;
}) {
  useLanguage();
  const [barcode, setBarcode] = useState('');
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function lookup() {
    if (busy || !barcode.trim()) return;
    setBusy(true);
    setResult(undefined);
    setError(undefined);
    const code = barcode.trim();
    try {
      const next = await api<Result>('/products/lookup/' + encodeURIComponent(code));
      setResult(next);
      if (!next.existing) onBarcode(code);
    } catch (e) {
      setError(e);
      if (/^\d{8,14}$/.test(code)) onBarcode(code);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset disabled={busy} className="barcode-lookup">
      <legend>{t('Find product by barcode')}</legend>
      <Field
        label={t('Scan or enter barcode')}
        hint={t(
          'Optional. Look up packaged food in Open Food Facts, then review before importing.',
        )}
      >
        <div className="barcode-input-with-camera">
          <input
            value={barcode}
            maxLength={100}
            onChange={(e) => {
              setBarcode(e.target.value);
              setResult(undefined);
              setError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void lookup();
              }
            }}
          />
          <CameraBarcodeScanner
            disabled={busy}
            onScan={(code) => {
              setBarcode(code);
              setResult(undefined);
              setError(undefined);
            }}
          />
        </div>
      </Field>
      <Button
        type="button"
        variant="outline"
        disabled={!barcode.trim() || busy}
        onClick={() => void lookup()}
      >
        {busy ? t('Looking up…') : t('Look up barcode')}
      </Button>
      <ErrorMessage error={error} />
      {result?.existing && (
        <div role="status">
          <p>
            {t('This barcode already belongs to ')}
            <strong>{result.existing.name}</strong> {t(' in your catalog. ')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              setBusy(true);
              try {
                const products = await api<Product[]>('/products');
                const product = products.find((p) => p.id === result.existing!.id);
                if (!product)
                  throw new Error('Product no longer available. Refresh and try again.');
                onExisting(product);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('Open existing product ')}
          </Button>
        </div>
      )}
      {result && !result.existing && !result.suggestion && (
        <p role="status">
          {t('No match found. Continue below; the barcode is already filled in.')}
        </p>
      )}
      {result?.suggestion && (
        <div className="barcode-suggestion">
          {result.suggestion.image && (
            <img src={result.suggestion.image} alt={t('Suggested product')} />
          )}
          <strong>{result.suggestion.name || t('Name unavailable')}</strong>
          <p>
            {[result.suggestion.brand, result.suggestion.quantity, result.suggestion.category]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {result.suggestion.description && <p>{result.suggestion.description}</p>}
          <div className="barcode-import-note">
            <p>
              {t(
                '(Check the package and details. Existing fields and your uploaded photo will be kept. Package size does not change the selling unit. ',
              )}
            </p>
            <p>
              <a
                href={'https://world.openfoodfacts.org/product/' + result.suggestion.barcode}
                target="_blank"
                rel="noreferrer"
              >
                {t('Open Food Facts contributors ')}
              </a>{' '}
              {t('· Data: ODbL · Photo: CC BY-SA 3.0.) ')}
            </p>
          </div>
          <Button
            type="button"
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await onUse(result.suggestion!);
                setResult(undefined);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('Use these details ')}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
