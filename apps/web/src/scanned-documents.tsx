import { useEffect, useState } from 'react';
import {
  type DocumentData,
  type DocumentProduct,
  type DocumentValidation,
  validateDocument,
} from '@eliza/contracts';
import { api, queryClient } from './api';
import { t, useLanguage } from './i18n';
import { ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { CameraBarcodeScanner } from './camera-barcode-scanner';

export type DocumentRecord = {
  id: string;
  filename: string;
  mimeType: string;
  documentType: string;
  extracted: DocumentData;
  edited: DocumentData;
  validation: DocumentValidation;
  version: number;
  status: 'draft' | 'saved';
  createdAt: string;
  updatedAt: string;
};
function displayAmount(value: string | null, currency: string, language: string) {
  if (value === null) return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return (
    new Intl.NumberFormat(language.toLowerCase().startsWith('ru') ? 'ru-RU' : 'en-GB', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(number) + (currency ? ' ' + currency : '')
  );
}
export function DocumentViewer({
  record,
  onSaved,
  canEdit = true,
}: {
  record: DocumentRecord;
  onSaved: (next: DocumentRecord) => void;
  canEdit?: boolean;
}) {
  const [data, setData] = useState<DocumentData>(() => structuredClone(record.edited));
  const [editing, setEditing] = useState(canEdit && record.status === 'draft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setData(structuredClone(record.edited));
    setEditing(canEdit && record.status === 'draft');
    setError(null);
  }, [record.id, record.version]);
  const validation = validateDocument(data);
  const changed = JSON.stringify(data) !== JSON.stringify(record.edited);
  function change(mutator: (draft: DocumentData) => void) {
    setData((current) => {
      const draft = structuredClone(current);
      mutator(draft);
      return draft;
    });
  }
  function productIndex(table: DocumentData['tables'][number]) {
    return table.columns.findIndex(
      (column) =>
        /^(product|item|товар|наименование)$/i.test(column.key) ||
        /^(product|item|товар|наименование)$/i.test(column.label.trim()),
    );
  }
  function costIndex(table: DocumentData['tables'][number]) {
    return table.columns.findIndex(
      (column) =>
        column.kind === 'price' || /^(unit cost|unit price|price|цена)$/i.test(column.label.trim()),
    );
  }
  function productValue(tableIndex: number, rowIndex: number, key: keyof DocumentProduct) {
    const table = data.tables[tableIndex];
    const product = table.rows[rowIndex].product;
    if (product) return product[key];
    if (key === 'name') return table.rows[rowIndex].cells[productIndex(table)] || '';
    if (key === 'cost') return table.rows[rowIndex].cells[costIndex(table)] || '';
    return '';
  }
  function setProductValue(
    tableIndex: number,
    rowIndex: number,
    key: keyof DocumentProduct,
    value: string,
  ) {
    change((draft) => {
      const table = draft.tables[tableIndex];
      const row = table.rows[rowIndex];
      row.product ??= {
        name: row.cells[productIndex(table)] || '',
        sku: '',
        barcode: '',
        plu: '',
        image: '',
        description: '',
        category: '',
        unit: '',
        price: '',
        cost: row.cells[costIndex(table)] || '',
        taxRate: '',
        minStock: '',
      };
      row.product[key] = value;
    });
  }
  async function addProductImage(tableIndex: number, rowIndex: number, file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(new Error(t('Choose an image file.')));
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 260 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const image = canvas.toDataURL('image/jpeg', 0.72);
      if (image.length > 60000) throw new Error(t('Choose a smaller product photo.'));
      setProductValue(tableIndex, rowIndex, 'image', image);
      setError(null);
    } catch (error) {
      setError(error);
    }
  }
  const productFields: { key: keyof DocumentProduct; label: string; multiline?: boolean }[] = [
    { key: 'barcode', label: t('Barcode') },
    { key: 'sku', label: t('SKU') },
    { key: 'plu', label: t('PLU') },
    { key: 'description', label: t('Description'), multiline: true },
    { key: 'category', label: t('Category') },
    { key: 'unit', label: t('Selling unit') },
    { key: 'price', label: t('Selling price') },
    { key: 'cost', label: t('Unit cost') },
    { key: 'taxRate', label: t('Tax rate') },
    { key: 'minStock', label: t('Minimum stock') },
  ];
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await api<DocumentRecord>('/documents/' + record.id + '/save', {
        data,
        version: record.version,
      });
      onSaved(saved);
      void queryClient.invalidateQueries({ queryKey: ['scanned-documents'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function editText(
    value: string | null,
    onChange: (value: string) => void,
    label: string,
    original?: string | null,
    multiline = false,
  ) {
    if (!editing) return <span>{value || '—'}</span>;
    return (
      <span
        className={original !== undefined && original !== value ? 'document-edited' : undefined}
      >
        {multiline ? (
          <textarea
            aria-label={label}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            aria-label={label}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        {original !== undefined && original !== value && (
          <small title={original ?? undefined}>{t('Edited from scan')}</small>
        )}
      </span>
    );
  }
  return (
    <section className="scanned-document-result">
      <div className="document-result-toolbar">
        <div>
          <span className={validation.incomplete ? 'document-review-badge' : 'document-scan-badge'}>
            {validation.incomplete ? '⚠ ' + t('Review required') : '✓ ' + t('Scan complete')}
          </span>
          <span className="document-type-badge">{data.documentType || t('Document')}</span>
        </div>
        <div className="document-result-actions">
          <span
            className={record.status === 'draft' ? 'document-review-badge' : 'document-scan-badge'}
          >
            {record.status === 'draft' ? t('Draft digital document') : t('Saved digital document')}
          </span>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            {t('Export PDF')}
          </Button>
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setData(structuredClone(record.edited));
                setEditing(!editing);
              }}
            >
              {editing ? t('Cancel editing') : t('Edit document')}
            </Button>
          )}
          {editing && (
            <Button
              type="button"
              disabled={busy || (!changed && record.status !== 'draft')}
              onClick={() => void save()}
            >
              {busy
                ? t('Saving…')
                : record.status === 'draft'
                  ? t('Save digital document')
                  : t('Save corrections')}
            </Button>
          )}
        </div>
      </div>
      <ErrorMessage error={error} />
      <div className="document-result-columns">
        <aside className="document-original">
          <h2>{t('Original scan')}</h2>
          {record.mimeType === 'application/pdf' ? (
            <iframe title={t('Original PDF')} src={'/api/documents/' + record.id + '/file'} />
          ) : (
            <img
              src={'/api/documents/' + record.id + '/file'}
              alt={t('Original scanned document')}
            />
          )}
          <small>{record.filename}</small>
        </aside>
        <article className="document-paper">
          <header className="document-paper-header">
            <div className="document-paper-heading">
              <span
                className={validation.incomplete ? 'document-review-badge' : 'document-scan-badge'}
              >
                {validation.incomplete ? '⚠ ' + t('Review required') : '✓ ' + t('Scan complete')}
              </span>
              <span className="document-type-badge">{data.documentType || t('Document')}</span>
            </div>
            <h2>
              {editText(
                data.title,
                (value) =>
                  change((draft) => {
                    draft.title = value;
                  }),
                t('Document title'),
                record.extracted.title,
              )}
            </h2>
            <div className="document-paper-meta">
              <label>
                {t('Number')}{' '}
                {editText(
                  data.number,
                  (value) =>
                    change((draft) => {
                      draft.number = value;
                    }),
                  t('Document number'),
                  record.extracted.number,
                )}
              </label>
              <label>
                {t('Date')}{' '}
                {editText(
                  data.date,
                  (value) =>
                    change((draft) => {
                      draft.date = value;
                    }),
                  t('Document date'),
                  record.extracted.date,
                )}
              </label>
            </div>
          </header>
          {data.parties.length > 0 && (
            <div className="document-parties">
              {data.parties.map((party, i) => (
                <div key={i}>
                  <span className="document-label">
                    {editText(
                      party.role,
                      (value) =>
                        change((draft) => {
                          draft.parties[i].role = value;
                        }),
                      t('Party role'),
                      record.extracted.parties[i]?.role,
                    )}
                  </span>
                  <strong>
                    {editText(
                      party.name,
                      (value) =>
                        change((draft) => {
                          draft.parties[i].name = value;
                        }),
                      t('Party name'),
                      record.extracted.parties[i]?.name,
                    )}
                  </strong>
                  {party.details && (
                    <p>
                      {editText(
                        party.details,
                        (value) =>
                          change((draft) => {
                            draft.parties[i].details = value;
                          }),
                        t('Party details'),
                        record.extracted.parties[i]?.details,
                        true,
                      )}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {data.fields.length > 0 && (
            <dl className="document-fields">
              {data.fields.map((field, i) => (
                <div key={i}>
                  <dt>
                    {editText(
                      field.label,
                      (value) =>
                        change((draft) => {
                          draft.fields[i].label = value;
                        }),
                      t('Field label'),
                      record.extracted.fields[i]?.label,
                    )}
                  </dt>
                  <dd>
                    {editText(
                      field.value,
                      (value) =>
                        change((draft) => {
                          draft.fields[i].value = value;
                          draft.fields[i].uncertain = false;
                        }),
                      t('Field value'),
                      record.extracted.fields[i]?.value,
                    )}
                    {field.uncertain && <em>{t('Uncertain')}</em>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {data.summary && (
            <p className="document-summary">
              {editText(
                data.summary,
                (value) =>
                  change((draft) => {
                    draft.summary = value;
                  }),
                t('Summary'),
                record.extracted.summary,
                true,
              )}
            </p>
          )}
          {data.sections.map((section, i) => (
            <section className="document-section" key={i}>
              <h3>
                {editText(
                  section.title,
                  (value) =>
                    change((draft) => {
                      draft.sections[i].title = value;
                    }),
                  t('Section title'),
                  record.extracted.sections[i]?.title,
                )}
              </h3>
              <p>
                {editText(
                  section.text,
                  (value) =>
                    change((draft) => {
                      draft.sections[i].text = value;
                    }),
                  t('Section text'),
                  record.extracted.sections[i]?.text,
                  true,
                )}
              </p>
            </section>
          ))}
          {data.tables.map((table, tableIndex) => (
            <section className="document-section" key={table.id || tableIndex}>
              <h3>
                {editText(
                  table.title,
                  (value) =>
                    change((draft) => {
                      draft.tables[tableIndex].title = value;
                    }),
                  t('Table title'),
                  record.extracted.tables[tableIndex]?.title,
                )}
              </h3>
              {productIndex(table) >= 0 && (
                <p className="document-product-help">
                  {t(
                    'Fill product details, save the digital document, then ask Eliza AI to create the products. Review each proposal before approval.',
                  )}
                </p>
              )}
              <div className="document-table-scroll">
                <table>
                  <thead>
                    {productIndex(table) >= 0 && (
                      <tr className="document-table-groups">
                        <th colSpan={table.columns.length + 1}>{t('Scanned document')}</th>
                        <th colSpan={productFields.length + 1}>{t('Product setup')}</th>
                        {editing && <th />}
                      </tr>
                    )}
                    <tr>
                      <th>#</th>
                      {table.columns.map((column, columnIndex) => (
                        <th
                          key={column.key || columnIndex}
                          className={
                            ['amount', 'price', 'quantity', 'number'].includes(column.kind)
                              ? 'numeric'
                              : ''
                          }
                        >
                          {editText(
                            column.label,
                            (value) =>
                              change((draft) => {
                                draft.tables[tableIndex].columns[columnIndex].label = value;
                              }),
                            t('Column label'),
                            record.extracted.tables[tableIndex]?.columns[columnIndex]?.label,
                          )}
                        </th>
                      ))}
                      {productIndex(table) >= 0 && (
                        <>
                          {productFields.map((field) => (
                            <th key={'product-' + field.key} className="document-product-column">
                              {field.label}
                            </th>
                          ))}
                          <th className="document-product-column">{t('Product photo')}</th>
                        </>
                      )}
                      {editing && <th>{t('Actions')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        <td>
                          {editText(
                            row.rowNumber,
                            (value) =>
                              change((draft) => {
                                draft.tables[tableIndex].rows[rowIndex].rowNumber = value;
                              }),
                            t('Row number'),
                            record.extracted.tables[tableIndex]?.rows[rowIndex]?.rowNumber,
                          )}
                        </td>
                        {row.cells.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className={
                              ['amount', 'price', 'quantity', 'number'].includes(
                                table.columns[cellIndex]?.kind,
                              )
                                ? 'numeric'
                                : ''
                            }
                          >
                            {editText(
                              cell,
                              (value) =>
                                change((draft) => {
                                  const changedRow = draft.tables[tableIndex].rows[rowIndex];
                                  changedRow.cells[cellIndex] = value;
                                  if (
                                    cellIndex === productIndex(draft.tables[tableIndex]) &&
                                    changedRow.product
                                  )
                                    changedRow.product.name = value;
                                }),
                              table.columns[cellIndex]?.label || t('Cell'),
                              record.extracted.tables[tableIndex]?.rows[rowIndex]?.cells[cellIndex],
                            )}
                            {row.uncertainCells?.includes(cellIndex) && (
                              <small className="document-cell-uncertain">{t('Uncertain')}</small>
                            )}
                          </td>
                        ))}
                        {productIndex(table) >= 0 && (
                          <>
                            {productFields.map((field) => (
                              <td key={'product-' + field.key} className="document-product-cell">
                                {editing ? (
                                  field.key === 'barcode' ? (
                                    <div className="barcode-input-with-camera">
                                      <input
                                        aria-label={field.label + ' ' + (rowIndex + 1)}
                                        value={productValue(tableIndex, rowIndex, field.key)}
                                        onChange={(event) =>
                                          setProductValue(
                                            tableIndex,
                                            rowIndex,
                                            field.key,
                                            event.target.value,
                                          )
                                        }
                                      />
                                      <CameraBarcodeScanner
                                        onScan={(code) =>
                                          setProductValue(tableIndex, rowIndex, 'barcode', code)
                                        }
                                      />
                                    </div>
                                  ) : field.key === 'unit' ? (
                                    <select
                                      aria-label={field.label + ' ' + (rowIndex + 1)}
                                      value={productValue(tableIndex, rowIndex, field.key)}
                                      onChange={(event) =>
                                        setProductValue(
                                          tableIndex,
                                          rowIndex,
                                          field.key,
                                          event.target.value,
                                        )
                                      }
                                    >
                                      <option value="">{t('Choose unit')}</option>
                                      {[
                                        'piece',
                                        'kilogram',
                                        'gram',
                                        'liter',
                                        'milliliter',
                                        'pack',
                                        'box',
                                        'other',
                                      ].map((unit) => (
                                        <option key={unit} value={unit}>
                                          {t(unit)}
                                        </option>
                                      ))}
                                    </select>
                                  ) : field.multiline ? (
                                    <textarea
                                      aria-label={field.label + ' ' + (rowIndex + 1)}
                                      value={productValue(tableIndex, rowIndex, field.key)}
                                      onChange={(event) =>
                                        setProductValue(
                                          tableIndex,
                                          rowIndex,
                                          field.key,
                                          event.target.value,
                                        )
                                      }
                                    />
                                  ) : (
                                    <input
                                      aria-label={field.label + ' ' + (rowIndex + 1)}
                                      value={productValue(tableIndex, rowIndex, field.key)}
                                      placeholder={
                                        field.key === 'sku' || field.key === 'plu'
                                          ? t('Auto')
                                          : undefined
                                      }
                                      onChange={(event) =>
                                        setProductValue(
                                          tableIndex,
                                          rowIndex,
                                          field.key,
                                          event.target.value,
                                        )
                                      }
                                    />
                                  )
                                ) : (
                                  <span>
                                    {productValue(tableIndex, rowIndex, field.key) || '—'}
                                  </span>
                                )}
                              </td>
                            ))}
                            <td className="document-product-cell">
                              {row.product?.image && (
                                <img
                                  className="document-product-image"
                                  src={row.product.image}
                                  alt={t('Product photo')}
                                />
                              )}
                              {editing && (
                                <input
                                  type="file"
                                  accept="image/*"
                                  aria-label={t('Product photo') + ' ' + (rowIndex + 1)}
                                  onChange={(event) => {
                                    void addProductImage(
                                      tableIndex,
                                      rowIndex,
                                      event.target.files?.[0],
                                    );
                                    event.target.value = '';
                                  }}
                                />
                              )}
                            </td>
                          </>
                        )}
                        {editing && (
                          <td>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() =>
                                change((draft) => {
                                  draft.tables[tableIndex].rows.splice(rowIndex, 1);
                                })
                              }
                            >
                              {t('Remove row')}
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  {table.footerRows.length > 0 && (
                    <tfoot>
                      {table.footerRows.map((footer, footerIndex) => (
                        <tr key={footerIndex}>
                          <th
                            colSpan={
                              table.columns.length +
                              (productIndex(table) >= 0 ? productFields.length + 1 : 0)
                            }
                          >
                            {editText(
                              footer.label,
                              (value) =>
                                change((draft) => {
                                  draft.tables[tableIndex].footerRows[footerIndex].label = value;
                                }),
                              t('Footer label'),
                              record.extracted.tables[tableIndex]?.footerRows[footerIndex]?.label,
                            )}
                          </th>
                          <td className="numeric">
                            {editText(
                              footer.value,
                              (value) =>
                                change((draft) => {
                                  draft.tables[tableIndex].footerRows[footerIndex].value = value;
                                }),
                              t('Footer value'),
                              record.extracted.tables[tableIndex]?.footerRows[footerIndex]?.value,
                            )}
                          </td>
                          {editing && <td />}
                        </tr>
                      ))}
                    </tfoot>
                  )}
                </table>
              </div>
              {editing && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    change((draft) => {
                      const target = draft.tables[tableIndex];
                      target.rows.push({
                        rowNumber: String(target.rows.length + 1),
                        cells: target.columns.map(() => ''),
                      });
                    })
                  }
                >
                  {t('Add row')}
                </Button>
              )}
            </section>
          ))}
          {(data.additionalText.length > 0 || data.annotations.length > 0) && (
            <section className="document-section">
              <h3>{t('Additional details')}</h3>
              {data.additionalText.map((value, i) => (
                <p key={'text-' + i}>
                  {editText(
                    value,
                    (next) =>
                      change((draft) => {
                        draft.additionalText[i] = next;
                      }),
                    t('Additional text'),
                    record.extracted.additionalText[i],
                    true,
                  )}
                </p>
              ))}
              {data.annotations.map((value, i) => (
                <p key={'annotation-' + i}>
                  <em>{t('Annotation')}:</em>{' '}
                  {editText(
                    value,
                    (next) =>
                      change((draft) => {
                        draft.annotations[i] = next;
                      }),
                    t('Annotation'),
                    record.extracted.annotations[i],
                    true,
                  )}
                </p>
              ))}
            </section>
          )}
          {(data.printedTotal || validation.rowSum !== null) && (
            <section className="document-totals">
              <div>
                <strong>{t('Printed document total')}</strong>
                <strong>
                  {editText(
                    data.printedTotal,
                    (value) =>
                      change((draft) => {
                        draft.printedTotal = value;
                      }),
                    t('Printed document total'),
                    record.extracted.printedTotal,
                  )}
                </strong>
              </div>
              {validation.rowSum !== null && (
                <div>
                  <span>
                    {validation.incomplete
                      ? t('Partial sum of extracted rows')
                      : t('Sum of table rows')}
                  </span>
                  <span>{displayAmount(validation.rowSum, data.currency, data.language)}</span>
                </div>
              )}
              {validation.difference !== null && validation.difference !== '0.00' && (
                <p className="document-discrepancy">
                  ⚠{' '}
                  {validation.incomplete
                    ? t('Partial sum differs from printed total')
                    : t('Discrepancy detected')}
                  :{' '}
                  {displayAmount(
                    String(Math.abs(Number(validation.difference))),
                    data.currency,
                    data.language,
                  )}
                </p>
              )}
            </section>
          )}
          {validation.expectedRows !== null && (
            <p
              className={
                validation.incomplete ? 'document-row-count incomplete' : 'document-row-count'
              }
            >
              {t('Extracted {count} of {expected} expected rows.', {
                count: validation.extractedRows,
                expected: validation.expectedRows,
              })}
            </p>
          )}
          {validation.warnings.length > 0 && (
            <div className="document-warnings">
              <h3>{t('Review warnings')}</h3>
              {validation.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
