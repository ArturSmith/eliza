import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import type { Product } from '@eliza/contracts';
import { t, useLanguage } from './i18n';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';

export function ProductBarcode({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  useLanguage();
  const svg = useRef<SVGSVGElement>(null);
  const [invalid, setInvalid] = useState(false);
  const code = product?.barcodes[0];
  useEffect(() => {
    if (!code || !svg.current) return;
    try {
      const digits = [...code].map(Number);
      const validEan13 =
        /^\d{13}$/.test(code) &&
        digits.reduce((sum, digit, index) => sum + digit * (index % 2 ? 3 : 1), 0) % 10 === 0;
      JsBarcode(svg.current, code, {
        format: validEan13 ? 'EAN13' : 'CODE128',
        width: 2,
        height: 80,
        margin: 12,
        displayValue: true,
      });
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }, [code]);
  return (
    <Dialog
      open={!!product}
      onOpenChange={(open) => !open && onClose()}
      title={t('Barcode for {value0}', { value0: product?.name ?? '' })}
      description={t('Print this barcode and attach it to the product.')}
    >
      <div className="product-barcode-print">
        <strong>{product?.name}</strong>
        <svg ref={svg} aria-label={t('Barcode {value0}', { value0: code ?? '' })} />
        {invalid && <p>{t('Barcode image unavailable for this code.')}</p>}
      </div>
      <Button disabled={!code || invalid} onClick={() => window.print()}>
        {t('Print barcode')}
      </Button>
    </Dialog>
  );
}
