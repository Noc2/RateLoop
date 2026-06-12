import type { ReactNode } from "react";
import { TexFormula } from "~~/components/docs/TexFormula";

export type FormulaRow = {
  label: string;
  tex: string;
};

export type WhereEntry = {
  /** Inline TeX for the symbol, e.g. "k_i". */
  symbol: string;
  meaning: ReactNode;
};

/**
 * Docs formula panel: displayed equations with labels, a "where" legend for
 * symbols, and optional parameter chips. Visual frame matches DocsDiagramFrame.
 */
export function FormulaCard({
  title,
  description,
  formulas,
  where,
  params,
  footnote,
}: {
  title: string;
  description?: ReactNode;
  formulas: FormulaRow[];
  where?: WhereEntry[];
  params?: [string, ReactNode][];
  footnote?: ReactNode;
}) {
  return (
    <figure className="not-prose my-6 rounded-lg bg-base-200 p-4 text-base-content">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-base-content/45">Formula</p>
          <h3 className="mt-1 text-xl font-semibold leading-tight text-base-content">{title}</h3>
        </div>
        {description ? (
          <figcaption className="max-w-xl text-sm leading-6 text-base-content/62 sm:text-right">
            {description}
          </figcaption>
        ) : null}
      </div>

      <div className="rounded-lg bg-base-100 p-4 sm:p-5">
        <div className="grid gap-4">
          {formulas.map(row => (
            <div key={row.label} className="grid items-center gap-1 sm:grid-cols-[200px_1fr] sm:gap-4">
              <p className="font-mono text-xs font-semibold uppercase tracking-wider text-base-content/45">
                {row.label}
              </p>
              <TexFormula tex={row.tex} display className="text-[1.05rem]" />
            </div>
          ))}
        </div>

        {where && where.length > 0 ? (
          <div className="mt-5 border-t border-base-content/10 pt-4">
            <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-base-content/45">where</p>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {where.map(entry => (
                <div key={entry.symbol} className="flex items-baseline gap-3 text-sm leading-6">
                  <dt className="shrink-0">
                    <TexFormula tex={entry.symbol} className="text-base-content" />
                  </dt>
                  <dd className="text-base-content/62">{entry.meaning}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>

      {params && params.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {params.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-base-content/10 bg-base-content/[0.05] px-3 py-2">
              <p className="text-xs font-semibold uppercase text-base-content/45">{label}</p>
              <p className="mt-1 font-mono text-sm font-semibold text-base-content">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {footnote ? <p className="mt-3 text-xs leading-5 text-base-content/55">{footnote}</p> : null}
    </figure>
  );
}
