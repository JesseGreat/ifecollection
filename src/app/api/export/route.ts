import { NextResponse, type NextRequest } from "next/server";
import { formatDateTime, variantLabel } from "@/lib/format";
import type { SessionStatus } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Quote everything; neutralise spreadsheet formulas (=, +, -, @) from user-typed text.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV of every sale line in the date range (admin only). Opens in Excel / Google Sheets. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: status } = await supabase.rpc("session_status");
  if ((status as SessionStatus | null)?.role !== "admin") {
    return NextResponse.json({ error: "ADMIN_ONLY" }, { status: 403 });
  }
  const today = (status as SessionStatus).today!;
  const from = DATE.test(req.nextUrl.searchParams.get("from") ?? "") ? req.nextUrl.searchParams.get("from")! : today;
  const to = DATE.test(req.nextUrl.searchParams.get("to") ?? "") ? req.nextUrl.searchParams.get("to")! : from;

  // Lagos is UTC+1 all year (no daylight saving).
  const end = new Date(`${to}T00:00:00+01:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  const { data, error } = await supabase
    .from("sales")
    .select(
      "receipt_no,created_at,total,status,void_reason,customer_name,customer_phone,profiles!sales_staff_id_fkey(full_name),sale_items(product_name,size,colour,unit_price,qty,line_total),sale_payments(method,amount,reference)",
    )
    .gte("created_at", `${from}T00:00:00+01:00`)
    .lt("created_at", end.toISOString())
    .order("created_at")
    .limit(20000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const header = [
    "Date/time (Lagos)", "Receipt", "Staff", "Status", "Product", "Variant", "Qty", "Unit price (NGN)",
    "Line total (NGN)", "Sale total (NGN)", "Cash", "Transfer", "POS", "Payment refs", "Customer", "Customer phone", "Void reason",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const s of data ?? []) {
    const pay = (m: string) => s.sale_payments.filter((p) => p.method === m).reduce((n, p) => n + p.amount, 0);
    const refs = s.sale_payments.map((p) => p.reference).filter(Boolean).join(" / ");
    for (const i of s.sale_items) {
      lines.push(
        [
          formatDateTime(s.created_at), s.receipt_no, (s.profiles as unknown as { full_name: string } | null)?.full_name,
          s.status, i.product_name, variantLabel(i.size, i.colour), i.qty, i.unit_price, i.line_total, s.total,
          pay("cash"), pay("transfer"), pay("pos"), refs, s.customer_name, s.customer_phone, s.void_reason,
        ].map(csvCell).join(","),
      );
    }
  }
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ifecollection-sales-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
