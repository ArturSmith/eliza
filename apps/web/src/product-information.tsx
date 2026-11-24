import type { ReactNode, Ref } from 'react';
import { ChevronDown } from 'lucide-react';
import { t, useLanguage } from './i18n';
import './product-information.css';

export function ProductAdditionalInformation({
  children,
  detailsRef,
  resetKey,
}: {
  children: ReactNode;
  detailsRef?: Ref<HTMLDetailsElement>;
  resetKey?: number;
}) {
  useLanguage();
  return (
    <details
      key={resetKey}
      ref={detailsRef}
      className="panel product-additional-information"
      onInvalidCapture={(event) => {
        event.currentTarget.open = true;
      }}
    >
      <summary>
        <span>{t('Additional information')}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="product-additional-content">{children}</div>
    </details>
  );
}
