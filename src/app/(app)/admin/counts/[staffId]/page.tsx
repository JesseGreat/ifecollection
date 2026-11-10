import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/PageHeader";
import { addDays, formatTime, variantLabel } from "@/lib/format";
import { createClient, getSessionStatus } from "@/lib/supabase/server";
import { ResolveLine } from "./ResolveLine";

export const metadata = { title: "Stock count detail" };

type Line = {
  id: string;
  variant_id: string;
  product_name: string;
  size: string;
  colour: string;
  expected: number;
  counted: number | null;
  reviewed_at: string | null;
  resolution: string | null;
};
type Count = { id: string; kind: "opening" | "closing"; status: string; submitted_at: string | null; skip_reason: string | null; stock_count_lines: Line[] };
type Item = { name: string; open?: Line; close?: Line; sold: number };

function Diff({ l }: { l?: Line }) {
  if (!l || l.counted == null) return <span className="text-muted">—</span>;
  const d = l.counted - l.expected;
  return (
    <span>
      <b>{l.counted}</b>
      {d !== 0 && <b className={d < 0 ? "ml-1 text-red-800" : "ml-1 text-amber-800"}>({d > 0 ? `+${d}` : d})</b>}
    </span>
  );
}

export default async function CountDetail({ params, searchParams }: PageProps<"/admin/counts/[staffId]">) {
  const { staffId } = await params;
  const sp = await searchParams;
  const status = await getSessionStatus();
  const day = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : status.today!;
  const supabase = await createClient();

  const [{ data: person }, { data: counts }, { data: sales }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", staffId).maybeSingle(),
    supabase
      .from("stock_counts")
      .select("id,kind,status,submitted_at,skip_reason,stock_count_lines(id,variant_id,product_name,size,colour,expected,counted,reviewed_at,resolution)")
      .eq("staff_id", staffId)
      .eq("business_day", day),
    supabase
      .from("sales")
      .select("status,sale_items(variant_id,product_name,size,colour,qty)")
      .eq("staff_id", staffId)
      .eq("status", "completed")
      .gte("created_at", `${day}T00:00:00+01:00`)
      .lt("created_at", `${addDays(day, 1)}T00:00:00+01:00`),
  ]);
  if (!person) notFound();

  const opening = (counts as Count[] | null)?.find((c) => c.kind === "opening");
  const closing = (counts as Count[] | null)?.find((c) => c.kind === "closing");

  // One row per item: what they started with, sold, and closed with.
  const items = new Map<string, Item>();
  const get = (id: string, name: string) => items.get(id) ?? (items.set(id, { name, sold: 0 }), items.get(id)!);
  opening?.stock_count_lines.forEach((l) => (get(l.variant_id, `${l.product_name} · ${variantLabel(l.size, l.colour)}`).open = l));
  closing?.stock_count_lines.forEach((l) => (get(l.variant_id, `${l.product_name} · ${variantLabel(l.size, l.colour)}`).close = l));
  (sales ?? []).forEach((s) =>
    s.sale_items.forEach((i) => (get(i.variant_id, `${i.product_name} · ${variantLabel(i.size, i.colour)}`).sold += i.qty)),
  );
  const rows = [...items.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  const toReview = [opening, closing].flatMap((c) =>
    (c?.stock_count_lines ?? [])
      .filter((l) => l.counted != null && l.counted !== l.expected)
      .map((l) => ({ l, kind: c!.kind })),
  );

  const header = (c: Count | undefined, label: string) =>
    !c ? (
      <span className="text-red-800">{label}: not done</span>
    ) : c.status === "skipped" ? (
      <span className="text-amber-900">
        {label}: skipped ({c.skip_reason}) at {formatTime(c.submitted_at!)}
      </span>
    ) : c.status === "in_progress" ? (
      <span className="text-amber-900">{label}: still counting</span>
    ) : (
      <span>
        {label}: ✓ {formatTime(c.submitted_at!)}
      </span>
    );

  return (
    <Page wide>
      <PageHeader title={`${person.full_name} · ${day}`} back={`/admin/counts?day=${day}`} />
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 rounded-2xl bg-white p-4 font-semibold">
        {header(opening, "Opening")}
        {header(closing, "Closing")}
      </div>

      <section className="mb-4 rounded-2xl bg-white">
        <h2 className="border-b border-line px-4 py-3 text-lg font-bold">Differences ({toReview.length})</h2>
        <ul className="divide-y divide-line">
          {toReview.map(({ l, kind }) => {
            const d = l.counted! - l.expected;
            return (
              <li key={l.id} className="px-4 py-3" data-testid="count-difference">
                <p className="font-semibold">
                  {l.product_name} · {variantLabel(l.size, l.colour)}
                </p>
                <p className="text-sm">
                  {kind === "opening" ? "Opening" : "Closing"} count: system {l.expected}, counted <b>{l.counted}</b> →{" "}
                  <b className={d < 0 ? "text-red-800" : "text-amber-800"}>{d < 0 ? `${-d} missing` : `${d} extra`}</b>
                </p>
                {l.reviewed_at ? (
                  <p className="mt-1 text-sm font-semibold text-muted">
                    {l.resolution === "accepted" ? "✓ Accepted – stock corrected" : "Dismissed – stock not changed"}
                  </p>
                ) : (
                  <ResolveLine lineId={l.id} />
                )}
              </li>
            );
          })}
          {!toReview.length && <li className="px-4 py-4 text-green-800">✓ No differences.</li>}
        </ul>
      </section>

      <section className="mb-8 rounded-2xl bg-white">
        <h2 className="border-b border-line px-4 py-3 text-lg font-bold">Every item</h2>
        <div className="grid grid-cols-[1fr_4rem_3rem_4rem] gap-x-2 border-b border-line bg-canvas px-4 py-2 text-xs font-bold text-muted uppercase">
          <span>Item</span>
          <span className="text-right">Opened</span>
          <span className="text-right">Sold</span>
          <span className="text-right">Closed</span>
        </div>
        <ul className="divide-y divide-line">
          {rows.map(([id, it]) => (
            <li key={id} className="grid grid-cols-[1fr_4rem_3rem_4rem] items-center gap-x-2 px-4 py-2 text-sm">
              <span className="min-w-0 truncate">{it.name}</span>
              <span className="text-right">
                <Diff l={it.open} />
              </span>
              <span className="text-right font-semibold">{it.sold || "—"}</span>
              <span className="text-right">
                <Diff l={it.close} />
              </span>
            </li>
          ))}
        </ul>
        <p className="px-4 py-3 text-xs text-muted">Numbers in brackets: difference from the system at the time of the count.</p>
      </section>
    </Page>
  );
}
