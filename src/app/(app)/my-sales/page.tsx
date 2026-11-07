import Link from "next/link";
import { Icon } from "@/components/icons";
import { Page, PageHeader } from "@/components/PageHeader";
import { formatNaira, formatTime, METHOD_LABEL } from "@/lib/format";
import { createClient, getSessionStatus } from "@/lib/supabase/server";

export const metadata = { title: "My sales today" };

export default async function MySalesPage() {
  const status = await getSessionStatus();
  const supabase = await createClient();
  const today = status.today!; // Lagos date from the DB clock
  const { data } = await supabase
    .from("sales")
    .select("id,receipt_no,created_at,total,status,sale_items(qty),sale_payments(method,amount)")
    .eq("staff_id", status.user_id!)
    .gte("created_at", `${today}T00:00:00+01:00`)
    .order("created_at", { ascending: false });
  const sales = data ?? [];
  const ok = sales.filter((s) => s.status === "completed");
  const total = ok.reduce((n, s) => n + s.total, 0);
  const byMethod = { cash: 0, transfer: 0, pos: 0 } as Record<string, number>;
  ok.forEach((s) => s.sale_payments.forEach((p: { method: string; amount: number }) => (byMethod[p.method] += p.amount)));

  return (
    <Page>
      <PageHeader title="My sales today" />
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="col-span-2 rounded-2xl bg-brand-800 p-4 text-white">
          <p className="text-sm text-brand-100">Total today</p>
          <p className="text-3xl font-bold" data-testid="my-total">
            {formatNaira(total)}
          </p>
          <p className="text-sm text-brand-100">
            {ok.length} sale{ok.length === 1 ? "" : "s"}
          </p>
        </div>
        {(["cash", "transfer", "pos"] as const).map((m) => (
          <div key={m} className="rounded-2xl bg-white p-3 last:col-span-2">
            <p className="text-sm text-muted">{METHOD_LABEL[m]}</p>
            <p className="text-lg font-bold">{formatNaira(byMethod[m])}</p>
          </div>
        ))}
      </div>
      <ul className="space-y-2 pb-6">
        {sales.map((s) => (
          <li key={s.id}>
            <Link href={`/receipt/${s.id}`} className="flex items-center gap-3 rounded-2xl bg-white p-3">
              <div className="flex-1">
                <p className="font-semibold">
                  {formatTime(s.created_at)} · {s.receipt_no}
                </p>
                <p className="text-sm text-muted">
                  {s.sale_items.reduce((n: number, i: { qty: number }) => n + i.qty, 0)} items ·{" "}
                  {[...new Set(s.sale_payments.map((p: { method: string }) => METHOD_LABEL[p.method]))].join(" + ")}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-bold ${s.status === "voided" ? "text-muted line-through" : ""}`}>{formatNaira(s.total)}</p>
                {s.status === "voided" && <p className="text-xs font-bold text-red-700">VOIDED</p>}
              </div>
              <Icon name="chevron" className="size-5 text-muted" />
            </Link>
          </li>
        ))}
        {!sales.length && <li className="py-10 text-center text-muted">No sales yet today.</li>}
      </ul>
    </Page>
  );
}
