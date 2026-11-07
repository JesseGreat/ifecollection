import Link from "next/link";
import { DateRange } from "@/components/DateRange";
import { Page } from "@/components/PageHeader";
import { parseRange } from "@/lib/format";
import { loadDashboard } from "@/lib/dashboard";
import { getSessionStatus } from "@/lib/supabase/server";
import { DashboardSections, SummaryCards } from "./DashboardBody";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/admin">) {
  const status = await getSessionStatus();
  const today = status.today!;
  const { from, to } = parseRange(await searchParams, today);
  const data = await loadDashboard(from, to);
  const qs = `from=${from}&to=${to}`;

  return (
    <Page wide>
      <div className="flex items-center justify-between pt-3 pb-2 lg:pt-6">
        <h1 className="text-xl font-bold lg:text-2xl">{from === to ? (from === today ? "Today" : from) : `${from} → ${to}`}</h1>
      </div>
      <div className="space-y-3 pb-8">
        <DateRange from={from} to={to} today={today} />
        <SummaryCards s={data.summary} />
        <DashboardSections s={data.summary} stock={data.stock} low={data.low} out={data.out} />
        <div className="grid grid-cols-2 gap-2 lg:flex">
          <a href={`/api/export?${qs}`} className="flex min-h-12 items-center justify-center rounded-xl border-2 border-line bg-white px-4 font-semibold">
            Download CSV
          </a>
          <Link href={`/admin/report?${qs}`} className="flex min-h-12 items-center justify-center rounded-xl border-2 border-line bg-white px-4 font-semibold">
            Printable report
          </Link>
        </div>
      </div>
    </Page>
  );
}
