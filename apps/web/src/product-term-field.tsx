import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { t, useLanguage } from './i18n';
import './product-fields.css';

/** Free text plus focus-open suggestions. The portal keeps the list outside clipped cards. */
export function ProductTermField({
  label,
  name,
  value,
  onChange,
  options,
  form,
  required = false,
  readOnly = false,
  disabled = false,
  loading = false,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  form?: string;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  useLanguage();
  const id = useId();
  const input = useRef<HTMLInputElement>(null),
    anchor = useRef<HTMLDivElement>(null),
    list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [filter, setFilter] = useState(''),
    [active, setActive] = useState(-1);
  const [position, setPosition] = useState<CSSProperties>({});
  const matches = options.filter((option) =>
    option.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const visible = open && !readOnly && !disabled;
  useLayoutEffect(() => {
    if (!visible) return;
    function place() {
      const bounds = anchor.current?.getBoundingClientRect();
      if (!bounds) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0,
        bottom = top + (viewport?.height ?? innerHeight);
      const below = bottom - bounds.bottom - 12,
        above = bounds.top - top - 12;
      const upwards = below < 220 && above > below;
      setPosition({
        position: 'fixed',
        left: Math.max(12, Math.min(bounds.left, innerWidth - bounds.width - 12)),
        width: Math.min(bounds.width, innerWidth - 24),
        top: upwards ? undefined : bounds.bottom + 4,
        bottom: upwards ? innerHeight - bounds.top + 4 : undefined,
        maxHeight: Math.max(0, Math.min(280, upwards ? above : below)),
      });
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const close = (event: PointerEvent) => {
      if (
        !anchor.current?.contains(event.target as Node) &&
        !list.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [visible]);
  useEffect(() => {
    if (active >= 0)
      document.getElementById(id + '-option-' + active)?.scrollIntoView({ block: 'nearest' });
  }, [active, id]);
  function choose(option: string) {
    onChange(option);
    setOpen(false);
    setActive(-1);
  }
  return (
    <div className="field product-term-field">
      <label htmlFor={id}>{label}</label>
      <div className="product-term-control" ref={anchor}>
        <input
          ref={input}
          id={id}
          name={name}
          form={form}
          value={value}
          maxLength={120}
          required={required}
          readOnly={readOnly}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={visible ? id + '-list' : undefined}
          aria-activedescendant={visible && active >= 0 ? id + '-option-' + active : undefined}
          onFocus={() => {
            setFilter('');
            setActive(-1);
            setOpen(true);
          }}
          onClick={() => {
            if (!open) {
              setFilter('');
              setActive(-1);
              setOpen(true);
            }
          }}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            onChange(event.target.value);
            setFilter(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (readOnly || disabled) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActive((index) =>
                matches.length
                  ? event.key === 'ArrowDown'
                    ? (index + 1) % matches.length
                    : index <= 0
                      ? matches.length - 1
                      : index - 1
                  : -1,
              );
            } else if (event.key === 'Enter' && visible && active >= 0 && matches[active]) {
              event.preventDefault();
              choose(matches[active]);
            } else if (event.key === 'Escape' && visible) {
              event.preventDefault();
              setOpen(false);
              setActive(-1);
            }
          }}
        />
        {!readOnly && (
          <button
            type="button"
            className="product-term-toggle"
            disabled={disabled}
            aria-label={t('Show saved values: {field}', { field: label })}
            aria-expanded={visible}
            aria-controls={visible ? id + '-list' : undefined}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              const next = !open;
              input.current?.focus();
              setFilter('');
              setActive(-1);
              setOpen(next);
            }}
          >
            <ChevronDown size={16} />
          </button>
        )}
      </div>
      {visible &&
        createPortal(
          <div
            className="product-term-options"
            role="listbox"
            aria-label={t('Saved values: {field}', { field: label })}
            id={id + '-list'}
            ref={list}
            style={position}
          >
            {matches.map((option, index) => (
              <div
                key={option}
                id={id + '-option-' + index}
                role="option"
                aria-selected={value === option}
                className={index === active ? 'active' : ''}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                {option}
                {value === option && <Check size={15} />}
              </div>
            ))}
            {!matches.length && (
              <p>
                {loading
                  ? t('Loading saved values…')
                  : t('No matching saved values. You can type a new value.')}
              </p>
            )}
          </div>,
          anchor.current?.closest('dialog[open]') ?? document.body,
        )}
    </div>
  );
}
