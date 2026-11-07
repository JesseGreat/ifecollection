import Link from "next/link";
import { ResponsiveTable, Section } from "@/components/ResponsiveTable";
import type { StockRow, Summary } from "@/lib/dashboard";
import { formatDateTime, formatNaira, variantLabel } from "@/lib/format";

function Card({ label, value, tone, testId }: { label: string; value: string; tone?: string; testId?: string }) {
  return (
    <div className={`rounded-2xl p-3 lg:p-4 ${tone ?? "bg-white"}`}>
      <p className="text-sm font-semibold opacity-80">{label}</p>
      <p className="text-xl font-bold lg:text-2xl" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

export function SummaryCards({ s }: { s: Summary }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
      <div className="col-span-2 rounded-2xl bg-brand-800 p-4 text-white">
        <p className="text-sm text-brand-100">Total sales</p>
        <p className="text-3xl font-bold" data-testid="dash-total">
          {formatNaira(s.total)}
        </p>
        <p className="text-sm text-brand-100">{s.units} items sold</p>
      </div>
      <Card label="Sales" value={String(s.count)} testId="dash-count" />
      <Card label="Cash" value={formatNaira(s.by_method.cash)} tone="bg-green-50 text-green-950" />
      <Card label="Transfer" value={formatNaira(s.by_method.transfer)} tone="bg-blue-50 text-blue-950" />
      <Card label="POS" value={formatNaira(s.by_method.pos)} tone="bg-orange-50 text-orange-950" />
    </div>
  );
}

export function DashboardSections({
  s,
  stock,
  low,
  out,
  printable,
}: {
  s: Summary;
  stock: StockRow[];
  low: StockRow[];
  out: StockRow[];
  printable?: boolean;
}) {
  const sold = (id: string) => s.sold_by_variant[id] ?? 0;
  return (
    <div className="space-y-3">
      <Section title="Sales per staff" count={s.by_staff.length} open>
        <ResponsiveTable
          rows={s.by_staff}
          rowKey={(r) => r.staff_id}
          empty="No sales in this period."
          columns={[
            { label: "Staff", cell: (r) => r.full_name, primary: true },
            { label: "Sales", cell: (r) => r.count, align: "right" },
            { label: "Amount", cell: (r) => formatNaira(r.total), align: "right" },
          ]}
        />
      </Section>

      <Section title="Best sellers" count={s.best_sellers.length} open={printable}>
        <ResponsiveTable
          rows={s.best_sellers}
          rowKey={(r) => r.variant_id}
          empty="No sales in this period."
          columns={[
            { label: "Item", cell: (r) => `${r.product_name} · ${variantLabel(r.size, r.colour)}`, primary: true },
            { label: "Units", cell: (r) => r.units, align: "right" },
            { label: "Amount", cell: (r) => formatNaira(r.revenue), align: "right" },
          ]}
        />
      </Section>

      <Section title="Low & out of stock" count={low.length + out.length} open>
        <ResponsiveTable
          rows={[...out, ...low]}
          rowKey={(r) => r.id}
          empty="All good – nothing is low."
          columns={[
            {
              label: "Item",
              primary: true,
              cell: (r) =>
                printable ? (
                  `${r.product_name} · ${variantLabel(r.size, r.colour)}`
                ) : (
                  <Link href={`/admin/products/${r.product_id}`} className="underline">
                    {r.product_name} · {variantLabel(r.size, r.colour)}
                  </Link>
                ),
            },
            {
              label: "Left",
              align: "right",
              cell: (r) =>
                r.quantity === 0 ? (
                  <span className="rounded bg-red-700 px-1.5 font-bold text-white">OUT</span>
                ) : (
                  <span className="rounded bg-amber-400 px-1.5 font-bold">{r.quantity}</span>
                ),
            },
            { label: "Sold", cell: (r) => sold(r.id), align: "right" },
          ]}
        />
      </Section>

      <Section title="Current stock" count={stock.length} open={printable}>
        <ResponsiveTable
          rows={stock}
          rowKey={(r) => r.id}
          empty="No products yet."
          columns={[
            { label: "Item", cell: (r) => `${r.product_name} · ${variantLabel(r.size, r.colour)}`, primary: true },
            { label: "In stock", cell: (r) => r.quantity, align: "right" },
            { label: "Sold", cell: (r) => sold(r.id), align: "right" },
          ]}
        />
      </Section>

      <Section title="Voided sales" count={s.voided.length} open={printable || s.voided.length > 0}>
        <ResponsiveTable
          rows={s.voided}
          rowKey={(r) => r.id}
          empty="No voided sales."
          columns={[
            {
              label: "Receipt",
              primary: true,
              cell: (r) =>
                printable ? r.receipt_no : (
                  <Link href={`/receipt/${r.id}`} className="underline">
                    {r.receipt_no}
                  </Link>
                ),
            },
            { label: "Amount", cell: (r) => formatNaira(r.total), align: "right" },
            { label: "Sold by", cell: (r) => r.staff_name },
            { label: "Voided by", cell: (r) => r.voided_by_name },
            { label: "When", cell: (r) => formatDateTime(r.voided_at) },
            { label: "Reason", cell: (r) => r.void_reason },
          ]}
        />
      </Section>
    </div>
  );
}
