import { Page, PageHeader } from "@/components/PageHeader";
import { loadDashboard } from "@/lib/dashboard";
import { formatDateTime, parseRange } from "@/lib/format";
import { getSessionStatus } from "@/lib/supabase/server";
import { DashboardSections, SummaryCards } from "../DashboardBody";
import { PrintButton } from "./PrintButton";

export const metadata = { title: "Report" };

export default async function ReportPage({ searchParams }: PageProps<"/admin/report">) {
  const status = await getSessionStatus();
  const { from, to } = parseRange(await searchParams, status.today!);
  const data = await loadDashboard(from, to);

  return (
    <Page wide>
      <PageHeader title="Printable report" back={`/admin?from=${from}&to=${to}`} action={<PrintButton />} />
      <div className="space-y-3 pb-8">
        <header className="rounded-2xl bg-white p-4 print:p-0">
          <h2 className="text-2xl font-bold text-brand-800">IfeCollection – Sales report</h2>
          <p>
            {from === to ? from : `${from} to ${to}`} · printed {formatDateTime(new Date())} by {status.full_name}
          </p>
        </header>
        <SummaryCards s={data.summary} />
        <DashboardSections s={data.summary} stock={data.stock} low={data.low} out={data.out} printable />
      </div>
    </Page>
  );
}
