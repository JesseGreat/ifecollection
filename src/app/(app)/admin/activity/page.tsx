import { Page, PageHeader } from "@/components/PageHeader";
import { formatDateTime, formatNaira } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Activity log" };

const LABEL: Record<string, string> = {
  login: "Logged in",
  logout: "Logged out",
  auto_logout: "Logged out at closing time",
  login_blocked_hours: "Tried to log in outside hours",
  login_blocked_inactive: "Tried to log in (account off)",
  sale_void: "Voided a sale",
  stock_restock: "Restocked",
  stock_adjust: "Corrected stock",
  price_change: "Changed a price",
  product_create: "Added a product",
  product_update: "Edited a product",
  settings_update: "Changed settings",
  staff_create: "Created an account",
  password_reset: "Reset a password",
  staff_deactivate: "Turned off an account",
  staff_reactivate: "Turned on an account",
};

function describe(action: string, d: Record<string, unknown>): string {
  switch (action) {
    case "sale_void":
      return `${d.receipt_no} · ${formatNaira(Number(d.total))} · “${d.reason}”`;
    case "price_change":
      return `${d.name ?? `${d.colour ?? ""} ${d.size ?? ""}`}: ${d.old == null ? "—" : formatNaira(Number(d.old))} → ${d.new == null ? "—" : formatNaira(Number(d.new))}`;
    case "stock_restock":
      return `+${d.qty} (now ${d.quantity_after})${d.note ? ` · ${d.note}` : ""}`;
    case "stock_adjust":
      return `${d.old} → ${d.new} · “${d.reason}”`;
    case "product_create":
    case "product_update":
      return String(d.name ?? "");
    case "staff_create":
      return `${d.full_name} (${d.username})`;
    default:
      return "";
  }
}

export default async function ActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  const { type } = await searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("audit_log")
    .select("id,action,details,created_at,profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (type === "logins") q = q.in("action", ["login", "logout", "auto_logout", "login_blocked_hours", "login_blocked_inactive"]);
  if (type === "changes") q = q.not("action", "in", "(login,logout,auto_logout)");
  const { data } = await q;

  return (
    <Page>
      <PageHeader title="Activity log" back="/admin/more" />
      <div className="mb-3 flex gap-2">
        {[
          ["", "All"],
          ["changes", "Voids, stock & prices"],
          ["logins", "Logins"],
        ].map(([v, l]) => (
          <a key={v} href={v ? `?type=${v}` : "?"} className={`min-h-11 rounded-full px-4 py-2.5 text-sm font-semibold ${(type ?? "") === v ? "bg-ink text-white" : "bg-white"}`}>
            {l}
          </a>
        ))}
      </div>
      <ul className="mb-8 divide-y divide-line rounded-2xl bg-white">
        {(data ?? []).map((a) => (
          <li key={a.id} className="px-4 py-3">
            <p className="font-semibold">
              {(a.profiles as unknown as { full_name: string } | null)?.full_name ?? "System"} · {LABEL[a.action] ?? a.action}
            </p>
            <p className="text-sm text-muted">
              {formatDateTime(a.created_at)}
              {describe(a.action, a.details as Record<string, unknown>) && ` · ${describe(a.action, a.details as Record<string, unknown>)}`}
            </p>
          </li>
        ))}
        {!data?.length && <li className="px-4 py-6 text-center text-muted">Nothing yet.</li>}
      </ul>
    </Page>
  );
}
