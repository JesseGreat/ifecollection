import Link from "next/link";
import { Page, PageHeader } from "@/components/PageHeader";
import { formatTime } from "@/lib/format";
import { createClient, getSessionStatus } from "@/lib/supabase/server";
import { SkipClosing } from "./SkipClosing";

export const metadata = { title: "Stock count" };

type Row = { kind: "opening" | "closing"; status: string; submitted_at: string | null; skip_reason: string | null };

export default async function CountHub() {
  const status = await getSessionStatus();
  const supabase = await createClient();
  const { data } = await supabase
    .from("stock_counts")
    .select("kind,status,submitted_at,skip_reason")
    .eq("staff_id", status.user_id!)
    .eq("business_day", status.today!);
  const opening = (data as Row[] | null)?.find((r) => r.kind === "opening");
  const closing = (data as Row[] | null)?.find((r) => r.kind === "closing");
  const openingDone = opening?.status === "submitted";
  const closingDone = closing?.status === "submitted" || closing?.status === "skipped";

  return (
    <Page>
      <PageHeader title="Stock count" />
      <p className="mb-4 text-muted">
        Count every item on the shelves. This keeps track of every single piece in the shop, so nothing goes missing.
      </p>

      <section className="mb-3 rounded-2xl bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">1. Morning (opening) count</h2>
            <p className="text-sm text-muted">Required before you can sell.</p>
          </div>
          {openingDone && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-bold text-green-900">✓ Done {formatTime(opening!.submitted_at!)}</span>}
        </div>
        {!openingDone && (
          <Link href="/count/opening" className="mt-3 flex min-h-14 items-center justify-center rounded-xl bg-brand-700 text-lg font-semibold text-white">
            {opening ? "Continue opening count" : "Start opening count"}
          </Link>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">2. Evening (closing) count</h2>
            <p className="text-sm text-muted">After this you cannot sell again today.</p>
          </div>
          {closing?.status === "submitted" && <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-bold text-green-900">✓ Done {formatTime(closing.submitted_at!)}</span>}
          {closing?.status === "skipped" && <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-950">Count tomorrow</span>}
        </div>
        {!openingDone && <p className="mt-3 text-muted">Do the morning count first.</p>}
        {openingDone && !closingDone && (
          <div className="mt-3 grid gap-2">
            <Link href="/count/closing" className="flex min-h-14 items-center justify-center rounded-xl bg-ink text-lg font-semibold text-white">
              {closing ? "Continue closing count" : "Start closing count"}
            </Link>
            <SkipClosing />
          </div>
        )}
      </section>
    </Page>
  );
}
