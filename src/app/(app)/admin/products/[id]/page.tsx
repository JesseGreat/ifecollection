import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/PageHeader";
import { formatDateTime, variantLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ProductForm, type FormProduct } from "../ProductForm";
import { ArchiveButton, StockPanel } from "./StockPanel";

export const metadata = { title: "Edit product" };

const REASON: Record<string, string> = {
  initial: "Opening stock",
  restock: "Restock",
  sale: "Sale",
  adjustment: "Correction",
  void: "Void (returned)",
};

export default async function EditProductPage({ params, searchParams }: PageProps<"/admin/products/[id]">) {
  const { id } = await params;
  const { saved } = await searchParams;
  const supabase = await createClient();

  const [{ data: product }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id,name,price,category_id,description,archived,product_images(id,provider,path,thumb_path,external_id,sort_order),product_variants(id,size,colour,sku,price_override,quantity,low_stock_threshold,active)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("categories").select("id,name").eq("active", true).order("sort_order").order("name"),
  ]);
  if (!product) notFound();

  const activeVariants = product.product_variants.filter((v: { active: boolean }) => v.active);
  const variantIds = product.product_variants.map((v: { id: string }) => v.id);
  const { data: movements } = await supabase
    .from("stock_movements")
    .select("id,variant_id,qty_change,quantity_after,reason,note,created_at,profiles(full_name)")
    .in("variant_id", variantIds.length ? variantIds : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at", { ascending: false })
    .limit(30);
  const variantName = new Map(
    product.product_variants.map((v: { id: string; size: string; colour: string }) => [v.id, variantLabel(v.size, v.colour)]),
  );

  const formProduct: FormProduct = {
    id: product.id,
    name: product.name,
    price: product.price,
    category_id: product.category_id,
    description: product.description,
    images: product.product_images,
    variants: activeVariants,
  };

  return (
    <Page>
      <PageHeader title={product.name} back="/admin/products" action={<ArchiveButton id={product.id} archived={product.archived} />} />
      {saved && (
        <p role="status" className="mb-3 rounded-xl border-l-4 border-green-700 bg-green-50 p-3 font-semibold text-green-950">
          Product saved.
        </p>
      )}
      {product.archived && (
        <p className="mb-3 rounded-xl border-l-4 border-amber-600 bg-amber-50 p-3 font-semibold">
          This product is archived. Staff cannot see or sell it.
        </p>
      )}

      <StockPanel variants={activeVariants} />

      <h2 className="mt-6 mb-2 text-lg font-bold">Edit details</h2>
      <ProductForm categories={categories ?? []} product={formProduct} />

      <details className="mb-32 rounded-2xl bg-white">
        <summary className="flex min-h-12 items-center px-4 font-bold">Stock history (last 30) ▸</summary>
        <ul className="divide-y divide-line">
          {(movements ?? []).map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <div>
                <p className="font-semibold">
                  {REASON[m.reason] ?? m.reason} · {variantName.get(m.variant_id)}
                </p>
                <p className="text-muted">
                  {formatDateTime(m.created_at)} · {(m.profiles as unknown as { full_name: string } | null)?.full_name ?? "—"}
                  {m.note ? ` · ${m.note}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-bold ${m.qty_change > 0 ? "text-green-800" : "text-red-800"}`}>
                  {m.qty_change > 0 ? `+${m.qty_change}` : m.qty_change}
                </p>
                <p className="text-xs text-muted">now {m.quantity_after}</p>
              </div>
            </li>
          ))}
          {!movements?.length && <li className="px-4 py-3 text-muted">No stock changes yet.</li>}
        </ul>
      </details>
    </Page>
  );
}
