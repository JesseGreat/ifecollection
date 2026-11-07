import { formatDateTime, formatNaira, METHOD_LABEL, variantLabel } from "@/lib/format";
import type { ReceiptData } from "@/lib/receipt";

export function Receipt({ r }: { r: ReceiptData }) {
  const voided = r.status === "voided";
  return (
    <article
      data-testid="receipt"
      className="relative mx-auto w-full max-w-sm rounded-2xl bg-white p-5 font-mono text-[15px] leading-6 shadow-sm print:max-w-none print:rounded-none print:p-0 print:shadow-none"
    >
      <header className="text-center">
        <h2 className="font-sans text-2xl font-bold text-brand-800">IfeCollection</h2>
        {r.store.address && <p className="text-sm">{r.store.address}</p>}
        {r.store.phone && <p className="text-sm">{r.store.phone}</p>}
      </header>
      <div className="my-3 border-t-2 border-dashed border-line" />
      <p>
        Receipt: <b data-testid="receipt-no">{r.receipt_no}</b>
      </p>
      <p>{formatDateTime(r.created_at)}</p>
      <p>Served by: {r.staff_name}</p>
      {r.customer_name && <p>Customer: {r.customer_name}</p>}
      {r.customer_phone && <p>Phone: {r.customer_phone}</p>}
      <div className="my-3 border-t-2 border-dashed border-line" />
      <ul className="space-y-2">
        {r.items.map((i, n) => (
          <li key={n}>
            <p className="font-bold">{i.product_name}</p>
            <p className="flex justify-between gap-2">
              <span>
                {variantLabel(i.size, i.colour)} · {i.qty} × {formatNaira(i.unit_price)}
              </span>
              <span>{formatNaira(i.line_total)}</span>
            </p>
          </li>
        ))}
      </ul>
      <div className="my-3 border-t-2 border-dashed border-line" />
      <p className="flex justify-between text-xl font-bold">
        <span>TOTAL</span>
        <span data-testid="receipt-total">{formatNaira(r.total)}</span>
      </p>
      {r.payments.map((p, n) => (
        <p key={n} className="flex justify-between">
          <span>
            {METHOD_LABEL[p.method]}
            {p.reference ? ` (${p.reference})` : ""}
          </span>
          <span>{formatNaira(p.amount)}</span>
        </p>
      ))}
      <div className="my-3 border-t-2 border-dashed border-line" />
      <p className="text-center text-sm">{r.store.footer}</p>
      {voided && (
        <div className="mt-4 rounded-xl border-4 border-red-700 p-2 text-center font-sans font-bold text-red-700">
          VOIDED
          {r.void_reason && <p className="text-sm font-normal">Reason: {r.void_reason}</p>}
        </div>
      )}
    </article>
  );
}
