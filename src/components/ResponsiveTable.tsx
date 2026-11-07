import type { ReactNode } from "react";

export type Column<T> = {
  label: string;
  cell: (row: T) => ReactNode;
  align?: "right";
  /** Shown as the bold title line of the phone card. */
  primary?: boolean;
};

/** A table on PC (and when printing); a list of cards on phones. */
export function ResponsiveTable<T>({
  rows,
  columns,
  rowKey,
  empty = "Nothing to show.",
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  empty?: string;
}) {
  if (!rows.length) return <p className="px-4 py-4 text-muted">{empty}</p>;
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary);
  return (
    <>
      <ul className="divide-y divide-line lg:hidden print:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)} className="px-4 py-3">
            <div className="font-semibold">{primary.cell(r)}</div>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 text-sm">
              {rest.map((c) => (
                <div key={c.label} className="flex justify-between gap-2">
                  <dt className="text-muted">{c.label}</dt>
                  <dd className="text-right font-semibold">{c.cell(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-left text-sm lg:table print:table">
        <thead className="bg-canvas">
          <tr>
            {columns.map((c) => (
              <th key={c.label} className={`px-4 py-2 ${c.align === "right" ? "text-right" : ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.label} className={`px-4 py-2 ${c.align === "right" ? "text-right" : ""}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Section({ title, count, open, children }: { title: string; count?: number; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group overflow-hidden rounded-2xl bg-white print:break-inside-avoid" >
      <summary className="flex min-h-14 cursor-pointer items-center justify-between px-4 text-lg font-bold">
        <span>
          {title}
          {count != null && <span className="ml-2 rounded-full bg-canvas px-2 text-sm">{count}</span>}
        </span>
        <span className="transition-transform group-open:rotate-90 print:hidden">▸</span>
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}
