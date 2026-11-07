import Link from "next/link";
import { DateRange } from "@/components/DateRange";
import { Icon } from "@/components/icons";
import { Page, PageHeader } from "@/components/PageHeader";
import { addDays, formatDateTime, formatNaira, METHOD_LABEL, parseRange } from "@/lib/format";
import { createClient, getSessionStatus } from "@/lib/supabase/server";

export const metadata = { title: "Sales" };

export default async function AdminSalesPage({ searchParams }: PageProps<"/admin/sales">) {
  const sp = await searchParams;
  const status = await getSessionStatus();
  const { from, to } = parseRange(sp, status.today!);
  const staff = typeof sp.staff === "string" ? sp.staff : "";
  const show = sp.show === "voided" ? "voided" : sp.show === "completed" ? "completed" : "all";
  const supabase = await createClient();

  let q = supabase
    .from("sales")
    .select("id,receipt_no,created_at,total,status,staff_id,profiles!sales_staff_id_fkey(full_name),sale_payments(method)")
    .gte("created_at", `${from}T00:00:00+01:00`)
    .lt("created_at", `${addDays(to, 1)}T00:00:00+01:00`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (staff) q = q.eq("staff_id", staff);
  if (show !== "all") q = q.eq("status", show);
  const [{ data: sales }, { data: people }] = await Promise.all([
    q,
    supabase.from("profiles").select("id,full_name").order("full_name"),
  ]);
  const base = `from=${from}&to=${to}`;

  return (
    <Page wide>
      <PageHeader title="Sales" />
      <div className="space-y-3 pb-8">
        <DateRange from={from} to={to} today={status.today!} />
        <form className="grid grid-cols-2 gap-2">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <select name="staff" defaultValue={staff} aria-label="Staff" className="min-h-12 rounded-xl border-2 border-line bg-white px-2">
            <option value="">All staff</option>
            {(people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
          <select name="show" defaultValue={show} aria-label="Status" className="min-h-12 rounded-xl border-2 border-line bg-white px-2">
            <option value="all">All sales</option>
            <option value="completed">Completed</option>
            <option value="voided">Voided</option>
          </select>
          <button className="col-span-2 min-h-12 rounded-xl bg-ink font-semibold text-white">Filter</button>
        </form>
        <p className="text-sm text-muted">
          {sales?.length ?? 0} sales ·{" "}
          {formatNaira((sales ?? []).filter((s) => s.status === "completed").reduce((n, s) => n + s.total, 0))} completed ·{" "}
          <a className="underline" href={`/api/export?${base}`}>
            CSV
          </a>
        </p>
        <ul className="space-y-2">
          {(sales ?? []).map((s) => (
            <li key={s.id}>
              <Link href={`/receipt/${s.id}`} className="flex items-center gap-3 rounded-2xl bg-white p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {s.receipt_no} · {(s.profiles as unknown as { full_name: string } | null)?.full_name}
                  </p>
                  <p className="text-sm text-muted">
                    {formatDateTime(s.created_at)} · {[...new Set(s.sale_payments.map((p) => METHOD_LABEL[p.method]))].join(" + ")}
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
          {!sales?.length && <li className="py-10 text-center text-muted">No sales found.</li>}
        </ul>
      </div>
    </Page>
  );
}
