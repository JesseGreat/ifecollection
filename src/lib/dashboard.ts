import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Summary = {
  from: string;
  to: string;
  total: number;
  count: number;
  units: number;
  by_method: { cash: number; transfer: number; pos: number };
  by_staff: { staff_id: string; full_name: string; count: number; total: number }[];
  best_sellers: { variant_id: string; product_name: string; size: string; colour: string; units: number; revenue: number }[];
  sold_by_variant: Record<string, number>;
  voided: {
    id: string;
    receipt_no: string;
    total: number;
    void_reason: string;
    voided_at: string;
    created_at: string;
    staff_name: string;
    voided_by_name: string;
  }[];
};

export type StockRow = {
  id: string;
  size: string;
  colour: string;
  quantity: number;
  low_stock_threshold: number;
  product_id: string;
  product_name: string;
};

export async function loadDashboard(from: string, to: string) {
  const supabase = await createClient();
  const [summary, stock] = await Promise.all([
    supabase.rpc("dashboard_summary", { p_from: from, p_to: to }),
    supabase
      .from("product_variants")
      .select("id,size,colour,quantity,low_stock_threshold,product_id,products!inner(name,archived)")
      .eq("active", true)
      .eq("products.archived", false)
      .limit(5000),
  ]);
  if (summary.error) throw new Error(summary.error.message);
  const rows: StockRow[] = (stock.data ?? [])
    .map((v) => ({
      id: v.id,
      size: v.size,
      colour: v.colour,
      quantity: v.quantity,
      low_stock_threshold: v.low_stock_threshold,
      product_id: v.product_id,
      product_name: (v.products as unknown as { name: string }).name,
    }))
    .sort((a, b) => a.product_name.localeCompare(b.product_name) || a.colour.localeCompare(b.colour) || a.size.localeCompare(b.size));
  return {
    summary: summary.data as Summary,
    stock: rows,
    out: rows.filter((r) => r.quantity === 0),
    low: rows.filter((r) => r.quantity > 0 && r.quantity <= r.low_stock_threshold),
  };
}
