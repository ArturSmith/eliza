import { useEffect, useId, useRef, useState } from 'react';
import { splitProductSize, joinProductSize, sizeUnits, type SizeUnit } from './product-size';
import { ChevronDown } from 'lucide-react';
import { t, useLanguage } from './i18n';
import './product-fields.css';

export function ProductSizeField({
  label,
  unitLabel,
  value,
  onChange,
  name = 'volume',
  form,
  required = false,
  readOnly = false,
  disabled = false,
}: {
  label: string;
  unitLabel?: string;
  value: string;
  onChange: (value: string) => void;
  name?: string;
  form?: string;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
}) {
  useLanguage();
  const id = useId();
  const [size, setSize] = useState(() => splitProductSize(value));
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current || readOnly) {
      setSize(splitProductSize(value));
      emitted.current = value;
    }
  }, [value, readOnly]);
  const labels: Record<SizeUnit, string> = {
    ml: 'Millilitres (ml)',
    L: 'Litres (L)',
    cl: 'Centilitres (cl)',
    g: 'Grams (g)',
    kg: 'Kilograms (kg)',
    mg: 'Milligrams (mg)',
    oz: 'Ounces (oz)',
    lb: 'Pounds (lb)',
    pcs: 'Pieces (pcs)',
  };
  function update(amount: string, unit: SizeUnit | '') {
    setSize({ amount, unit, legacy: '' });
    emitted.current = joinProductSize(amount, unit);
    onChange(emitted.current);
  }
  return (
    <div className="field product-size-field">
      <label id={id + '-label'} htmlFor={id}>
        {label}
      </label>
      <div className="product-size-controls">
        <input
          id={id}
          aria-labelledby={id + '-label'}
          aria-describedby={size.legacy ? id + '-legacy' : undefined}
          name={name + 'Amount'}
          form={form}
          type="text"
          inputMode="decimal"
          maxLength={24}
          pattern="(?=.*[1-9])(?:[0-9]+(?:[.,][0-9]+)?|[.,][0-9]+)"
          title={t('Enter a size greater than zero.')}
          placeholder="500"
          value={size.amount}
          readOnly={readOnly}
          disabled={disabled}
          required={required || (!!size.unit && !size.legacy)}
          onChange={(event) => {
            const next = event.target.value;
            if (/^\d*(?:[.,]\d*)?$/.test(next)) update(next, size.unit);
          }}
        />
        <div className={'product-size-unit' + (readOnly ? ' is-readonly' : '')}>
          <span className="product-size-unit-value" aria-hidden="true">
            <span className="product-size-unit-label">
              {size.unit ? t(size.unit) : t('Choose unit')}
            </span>
            {!readOnly && <ChevronDown size={16} />}
          </span>
          <select
            style={{ opacity: 0 }}
            aria-label={unitLabel ?? t('Size unit')}
            form={form}
            name={name + 'Unit'}
            value={size.unit}
            disabled={disabled || readOnly}
            required={required || (!!size.amount && !size.legacy)}
            onChange={(event) => update(size.amount, event.target.value as SizeUnit | '')}
          >
            <option value="">{t('Choose a size unit')}</option>
            {sizeUnits.map((unit) => (
              <option key={unit} value={unit}>
                {t(labels[unit])}
              </option>
            ))}
          </select>
        </div>
      </div>
      {(size.legacy || (!required && !readOnly && !disabled && (size.amount || size.unit))) && (
        <small id={id + '-legacy'}>
          {size.legacy &&
            t('Existing size: {value}. It will be kept until you replace it.', {
              value: size.legacy,
            })}
          {!required && !readOnly && !disabled && (
            <button
              type="button"
              className="product-size-clear"
              onClick={() => {
                setSize({ amount: '', unit: '', legacy: '' });
                emitted.current = '';
                onChange('');
              }}
            >
              {t('Clear size')}
            </button>
          )}
        </small>
      )}
      <input type="hidden" name={name} value={value} form={form} disabled={disabled} />
    </div>
  );
}
