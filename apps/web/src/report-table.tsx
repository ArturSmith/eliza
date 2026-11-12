import type { ReactNode } from 'react';
import { t, useLanguage } from './i18n';

export function DashboardTable({
  title,
  description,
  head,
  rows,
  empty,
}: {
  title: string;
  description?: string;
  head: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  useLanguage();
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{t(title)}</h2>
        {description && <p>{t(description)}</p>}
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h}>{t(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="panel-padding muted">{t(empty)}</p>
      )}
    </section>
  );
}
