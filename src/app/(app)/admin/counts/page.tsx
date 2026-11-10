import Link from "next/link";
import { Icon } from "@/components/icons";
import { Page, PageHeader } from "@/components/PageHeader";
import { addDays, formatNaira, formatTime } from "@/lib/format";
import { createClient, getSessionStatus } from "@/lib/supabase/server";

export const metadata = { title: "Stock counts" };

type CountSummary = {
  id: string;
  status: "in_progress" | "submitted" | "skipped";
  submitted_at: string | null;
  skip_reason?: string | null;
  items: number;
  units: number;
  mismatches: number;
  unresolved: number;
  missing: number;
  extra: number;
} | null;
type Row = {
  staff_id: string;
  full_name: string;
  opening: CountSummary;
  closing: CountSummary;
  sales: number;
  units_sold: number;
  total: number;
};

function CountCell({ label, c }: { label: string; c: CountSummary }) {
  let body: React.ReactNode;
  if (!c) body = <span className="font-semibold text-red-800">Not done</span>;
  else if (c.status === "in_progress") body = <span className="font-semibold text-amber-900">Counting…</span>;
  else if (c.status === "skipped") body = <span className="font-semibold text-amber-900">Skipped – count tomorrow</span>;
  else
    body = (
      <>
        <span className="text-xl font-bold">{c.units}</span> <span className="text-sm text-muted">pcs · {formatTime(c.submitted_at!)}</span>
        {c.mismatches > 0 ? (
          <span className="block text-sm font-bold text-red-800">
            {c.missing > 0 && `${c.missing} missing`}
            {c.missing > 0 && c.extra > 0 && " · "}
            {c.extra > 0 && `${c.extra} extra`}
            {c.unresolved > 0 && ` (${c.unresolved} to review)`}
          </span>
        ) : (
          <span className="block text-sm font-semibold text-green-800">✓ All matched</span>
        )}
      </>
    );
  return (
    <div>
      <p className="text-xs font-semibold text-muted uppercase">{label}</p>
      {body}
    </div>
  );
}

export default async function CountsReport({ searchParams }: PageProps<"/admin/counts">) {
  const status = await getSessionStatus();
  const sp = await searchParams;
  const day = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : status.today!;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_count_report", { p_day: day });
  const rows = (data ?? []) as Row[];

  return (
    <Page wide>
      <PageHeader title="Stock counts" back="/admin/more" />
      <div className="mb-3 flex items-center gap-2">
        <Link href={`?day=${addDays(day, -1)}`} aria-label="Previous day" className="grid size-12 place-items-center rounded-xl bg-white text-xl">
          ‹
        </Link>
        <form className="flex min-w-0 flex-1 gap-2">
          <input
            type="date"
            name="day"
            defaultValue={day}
            max={status.today}
            aria-label="Day"
            className="min-h-12 w-full min-w-0 rounded-xl border-2 border-line bg-white px-3"
          />
          <button className="min-h-12 rounded-xl bg-ink px-4 font-semibold text-white">Show</button>
        </form>
        {day < status.today! ? (
          <Link href={`?day=${addDays(day, 1)}`} aria-label="Next day" className="grid size-12 place-items-center rounded-xl bg-white text-xl">
            ›
          </Link>
        ) : (
          <span className="size-12" />
        )}
      </div>
      <p className="mb-3 text-sm text-muted">
        Each sales person counts the stock before selling (opening) and at the end (closing). Started with − sold should equal
        closing; any difference is shown in red.
      </p>
      {error && <p className="text-red-700">{error.message}</p>}
      <ul className="space-y-3 pb-8">
        {rows.map((r) => (
          <li key={r.staff_id}>
            <Link href={`/admin/counts/${r.staff_id}?day=${day}`} className="block rounded-2xl bg-white p-4" data-testid="count-report-row">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-lg font-bold">{r.full_name}</p>
                <Icon name="chevron" className="size-5 text-muted" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <CountCell label="Started with" c={r.opening} />
                <div>
                  <p className="text-xs font-semibold text-muted uppercase">Sold</p>
                  <span className="text-xl font-bold">{r.units_sold}</span> <span className="text-sm text-muted">pcs</span>
                  <span className="block text-sm text-muted">
                    {r.sales} sales · {formatNaira(r.total)}
                  </span>
                </div>
                <CountCell label="Closing" c={r.closing} />
              </div>
            </Link>
          </li>
        ))}
        {!rows.length && <li className="py-10 text-center text-muted">No sales staff yet.</li>}
      </ul>
    </Page>
  );
}
