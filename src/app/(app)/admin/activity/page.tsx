import { Page, PageHeader } from "@/components/PageHeader";
import { formatDateTime, formatNaira } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Activity log" };

const LABEL: Record<string, string> = {
  login: "Logged in",
  logout: "Logged out",
  auto_logout: "Logged out at closing time",
  session_replaced: "Logged in on another device (old device logged out)",
  login_blocked_hours: "Tried to log in outside hours",
  login_blocked_inactive: "Tried to log in (account off)",
  login_blocked_location: "Tried to log in without sharing location",
  sale_void: "Voided a sale",
  stock_count: "Submitted a stock count",
  stock_count_skipped: "Skipped closing count (count tomorrow)",
  stock_count_accept: "Accepted a count difference (stock corrected)",
  stock_count_dismiss: "Dismissed a count difference",
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
    case "stock_count":
      return `${d.kind} · ${d.items} items${Number(d.mismatches) ? ` · ${d.missing} missing, ${d.extra} extra` : " · all matched"}`;
    case "stock_count_skipped":
      return String(d.reason ?? "");
    case "stock_count_accept":
    case "stock_count_dismiss":
      return `${d.product} ${d.colour ?? ""} ${d.size ?? ""} · system ${d.expected}, counted ${d.counted} (${d.staff}, ${d.kind})`;
    case "staff_create":
      return `${d.full_name} (${d.username})`;
    default:
      return "";
  }
}

const LOGIN_ACTIONS = ["login", "logout", "auto_logout", "login_blocked_hours", "login_blocked_inactive", "login_blocked_location", "session_replaced"];

const LOCATION_ERROR: Record<string, string> = {
  denied: "location refused",
  unavailable: "GPS off / unavailable",
  timeout: "GPS too slow",
  unsupported: "browser cannot share location",
  not_shared: "location not shared",
};

/** Device, network location and GPS recorded with a login (see log_auth_event). */
function LoginPlace({ d }: { d: Record<string, unknown> }) {
  if (!d.device && !d.city && !d.country && d.lat == null && !d.location_error) return null;
  const network = [d.city, d.region, d.country].filter(Boolean).join(", ");
  const hasGps = typeof d.lat === "number" && typeof d.lng === "number";
  return (
    <div className="mt-1 space-y-0.5 text-sm">
      {hasGps ? (
        <p>
          📍 GPS{typeof d.accuracy === "number" ? ` (±${d.accuracy} m)` : ""}:{" "}
          <a
            href={`https://www.google.com/maps?q=${d.lat},${d.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-brand-700 underline"
          >
            View on map
          </a>
        </p>
      ) : d.location_error ? (
        <p className="font-semibold text-red-800">📍 No GPS: {LOCATION_ERROR[String(d.location_error)] ?? String(d.location_error)}</p>
      ) : null}
      {(network || d.ip) ? (
        <p className="text-muted">
          🌐 {network || "Network"}
          {d.ip ? ` · IP ${String(d.ip)}` : ""}
        </p>
      ) : null}
      {d.device ? <p className="text-muted">📱 {String(d.device)}</p> : null}
    </div>
  );
}

export default async function ActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  const { type } = await searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("audit_log")
    .select("id,action,details,created_at,profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (type === "logins") q = q.in("action", LOGIN_ACTIONS);
  if (type === "changes") q = q.not("action", "in", `(${LOGIN_ACTIONS.join(",")})`);
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
            {LOGIN_ACTIONS.includes(a.action) && <LoginPlace d={a.details as Record<string, unknown>} />}
          </li>
        ))}
        {!data?.length && <li className="px-4 py-6 text-center text-muted">Nothing yet.</li>}
      </ul>
    </Page>
  );
}
