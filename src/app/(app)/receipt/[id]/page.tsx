import Link from "next/link";
import { Page, PageHeader } from "@/components/PageHeader";
import { Receipt } from "@/components/Receipt";
import type { ReceiptData } from "@/lib/receipt";
import { createClient, getSessionStatus } from "@/lib/supabase/server";
import { ReceiptActions, VoidSale } from "./ReceiptActions";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params, searchParams }: PageProps<"/receipt/[id]">) {
  const { id } = await params;
  const { new: isNew } = await searchParams;
  const status = await getSessionStatus();
  const supabase = await createClient();

  // RLS: staff only get their own sales from today; the admin gets everything.
  const [{ data: sale }, { data: settings }] = await Promise.all([
    supabase
      .from("sales")
      .select(
        "id,receipt_no,created_at,total,status,void_reason,customer_name,customer_phone,profiles!sales_staff_id_fkey(full_name),sale_items(product_name,size,colour,unit_price,qty,line_total),sale_payments(method,amount,reference)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("settings").select("store_phone,store_address,receipt_footer").maybeSingle(),
  ]);

  const isAdmin = status.role === "admin";
  if (!sale) {
    return (
      <Page>
        <PageHeader title="Receipt" back={isAdmin ? "/admin/sales" : "/my-sales"} />
        <p className="py-10 text-center text-muted">Receipt not found. Staff can only open their own receipts from today.</p>
      </Page>
    );
  }

  const r: ReceiptData = {
    id: sale.id,
    receipt_no: sale.receipt_no,
    created_at: sale.created_at,
    total: sale.total,
    status: sale.status,
    void_reason: sale.void_reason,
    customer_name: sale.customer_name,
    customer_phone: sale.customer_phone,
    staff_name: (sale.profiles as unknown as { full_name: string } | null)?.full_name ?? "",
    items: sale.sale_items,
    payments: sale.sale_payments,
    store: {
      phone: settings?.store_phone ?? null,
      address: settings?.store_address ?? null,
      footer: settings?.receipt_footer ?? "Thank you for shopping with us!",
    },
  };

  return (
    <Page>
      <PageHeader title={isNew ? "Sale saved" : "Receipt"} back={isNew ? "/sell" : isAdmin ? "/admin/sales" : "/my-sales"} />
      {isNew && (
        <p role="status" className="mb-3 rounded-xl border-l-4 border-green-700 bg-green-50 p-3 text-lg font-bold text-green-950 print:hidden">
          ✓ Sale saved
        </p>
      )}
      <Receipt r={r} />
      <div className="mx-auto mt-4 max-w-sm space-y-2 pb-8 print:hidden">
        <ReceiptActions r={r} />
        <Link href="/sell" className="flex min-h-14 items-center justify-center rounded-xl bg-brand-700 text-lg font-semibold text-white">
          New sale
        </Link>
        {isAdmin && r.status === "completed" && <VoidSale saleId={r.id} receiptNo={r.receipt_no} />}
      </div>
    </Page>
  );
}
