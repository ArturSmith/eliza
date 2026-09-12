import { useState } from 'react';
import type { Product } from '@eliza/contracts';
import { api } from './api';
import { Button } from './components/ui/button';
import { Field, ErrorMessage } from './forms';
type Suggestion = {
  barcode: string;
  name: string;
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
      <legend>Find product by barcode</legend>
      <Field
        label="Scan or enter barcode"
        hint="Optional. Look up packaged food in Open Food Facts, then review before importing."
      >
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
      </Field>
      <Button
        type="button"
        variant="outline"
        disabled={!barcode.trim() || busy}
        onClick={() => void lookup()}
      >
        {busy ? 'Looking up…' : 'Look up barcode'}
      </Button>
      <ErrorMessage error={error} />
      {result?.existing && (
        <div role="status">
          <p>
            This barcode already belongs to <strong>{result.existing.name}</strong> in your catalog.
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
            Open existing product
          </Button>
        </div>
      )}
      {result && !result.existing && !result.suggestion && (
        <p role="status">No match found. Continue below; the barcode is already filled in.</p>
      )}
      {result?.suggestion && (
        <div className="barcode-suggestion">
          {result.suggestion.image && <img src={result.suggestion.image} alt="Suggested product" />}
          <strong>{result.suggestion.name || 'Name unavailable'}</strong>
          <p>
            {[result.suggestion.brand, result.suggestion.quantity, result.suggestion.category]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p>
            Check the package and details. Existing fields and your uploaded photo will be kept.
            Package size does not change the selling unit.
          </p>
          <p>
            <a
              href={'https://world.openfoodfacts.org/product/' + result.suggestion.barcode}
              target="_blank"
              rel="noreferrer"
            >
              Open Food Facts contributors
            </a>{' '}
            · Data: ODbL · Photo: CC BY-SA 3.0
          </p>
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
            Use these details
          </Button>
        </div>
      )}
    </fieldset>
  );
}
