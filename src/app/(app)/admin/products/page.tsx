import Link from "next/link";
import { Icon } from "@/components/icons";
import { Page, PageHeader } from "@/components/PageHeader";
import { formatNaira } from "@/lib/format";
import { imageUrl } from "@/lib/images";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Products" };

type Row = {
  id: string;
  name: string;
  price: number;
  archived: boolean;
  categories: { name: string } | null;
  product_images: { provider: string; path: string; thumb_path: string | null; sort_order: number }[];
  product_variants: { quantity: number; low_stock_threshold: number; active: boolean }[];
};

export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const { q = "", show = "active" } = (await searchParams) as { q?: string; show?: string };
  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select("id,name,price,archived,categories(name),product_images(provider,path,thumb_path,sort_order),product_variants(quantity,low_stock_threshold,active)")
    .eq("archived", show === "archived")
    .order("name")
    .limit(500);
  if (q.trim()) query = query.ilike("name", `%${q.trim().replace(/[%_]/g, "")}%`);
  const { data, error } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const stockInfo = (r: Row) => {
    const vs = r.product_variants.filter((v) => v.active);
    const total = vs.reduce((n, v) => n + v.quantity, 0);
    const out = vs.filter((v) => v.quantity === 0).length;
    const low = vs.filter((v) => v.quantity > 0 && v.quantity <= v.low_stock_threshold).length;
    return { total, out, low };
  };

  return (
    <Page wide>
      <PageHeader title="Products" />
      <form className="mb-3 flex gap-2" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search products"
          aria-label="Search products"
          className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-line bg-white px-3"
        />
        <input type="hidden" name="show" value={show} />
        <button className="min-h-12 rounded-xl bg-brand-700 px-4 font-semibold text-white">Search</button>
      </form>
      <div className="mb-3 flex gap-2">
        <Link href="/admin/products" className={`min-h-11 rounded-full px-4 py-2.5 text-sm font-semibold ${show !== "archived" ? "bg-ink text-white" : "bg-white"}`}>
          For sale
        </Link>
        <Link href="/admin/products?show=archived" className={`min-h-11 rounded-full px-4 py-2.5 text-sm font-semibold ${show === "archived" ? "bg-ink text-white" : "bg-white"}`}>
          Archived
        </Link>
      </div>
      {error && <p className="text-red-700">{error.message}</p>}
      {rows.length === 0 && <p className="py-10 text-center text-muted">No products yet. Tap “New product” to add one.</p>}

      {/* Phone: cards */}
      <ul className="space-y-2 lg:hidden">
        {rows.map((r) => {
          const s = stockInfo(r);
          const img = [...r.product_images].sort((a, b) => a.sort_order - b.sort_order)[0];
          return (
            <li key={r.id}>
              <Link href={`/admin/products/${r.id}`} className="flex items-center gap-3 rounded-2xl bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img ? imageUrl(img, "thumb") : "/icons/icon-192.png"} alt="" loading="lazy" className="size-16 rounded-xl bg-canvas object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.name}</p>
                  <p className="text-sm text-muted">
                    {r.categories?.name ?? "No category"} · {formatNaira(r.price)}
                  </p>
                  <p className="text-sm">
                    <b>{s.total}</b> in stock
                    {s.out > 0 && <span className="ml-2 rounded bg-red-700 px-1.5 text-xs font-bold text-white">{s.out} out</span>}
                    {s.low > 0 && <span className="ml-2 rounded bg-amber-400 px-1.5 text-xs font-bold text-black">{s.low} low</span>}
                  </p>
                </div>
                <Icon name="chevron" className="size-5 text-muted" />
              </Link>
            </li>
          );
        })}
      </ul>

      {/* PC: table */}
      <table className="hidden w-full overflow-hidden rounded-2xl bg-white text-left lg:table">
        <thead className="bg-canvas text-sm">
          <tr>
            <th className="p-3">Product</th>
            <th className="p-3">Category</th>
            <th className="p-3 text-right">Price</th>
            <th className="p-3 text-right">In stock</th>
            <th className="p-3">Alerts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const s = stockInfo(r);
            const img = [...r.product_images].sort((a, b) => a.sort_order - b.sort_order)[0];
            return (
              <tr key={r.id} className="hover:bg-brand-50">
                <td className="p-2">
                  <Link href={`/admin/products/${r.id}`} className="flex items-center gap-3 font-semibold">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img ? imageUrl(img, "thumb") : "/icons/icon-192.png"} alt="" loading="lazy" className="size-10 rounded-lg object-cover" />
                    {r.name}
                  </Link>
                </td>
                <td className="p-3">{r.categories?.name ?? "—"}</td>
                <td className="p-3 text-right">{formatNaira(r.price)}</td>
                <td className="p-3 text-right font-semibold">{s.total}</td>
                <td className="p-3 text-sm">
                  {s.out > 0 && <span className="mr-2 rounded bg-red-700 px-1.5 font-bold text-white">{s.out} out</span>}
                  {s.low > 0 && <span className="rounded bg-amber-400 px-1.5 font-bold">{s.low} low</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="bottom-[calc(3.5rem+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-60 fixed inset-x-0 z-20 p-3 lg:static lg:mt-4 lg:p-0">
        <Link
          href="/admin/products/new"
          className="mx-auto flex min-h-14 max-w-3xl items-center justify-center gap-2 rounded-xl bg-brand-700 text-lg font-semibold text-white shadow-lg lg:mx-0 lg:inline-flex lg:px-6"
        >
          <Icon name="plus" /> New product
        </Link>
      </div>
    </Page>
  );
}
