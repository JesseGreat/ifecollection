"use client";
// Product list for the sell screen. Shown instantly from the phone's cache, then refreshed from Supabase.
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export type Variant = {
  id: string;
  size: string;
  colour: string;
  sku: string | null;
  price_override: number | null;
  quantity: number;
  low_stock_threshold: number;
  active: boolean;
};
export type Product = {
  id: string;
  name: string;
  price: number;
  category_id: string | null;
  description: string | null;
  product_images: { provider: string; path: string; thumb_path: string | null; sort_order: number }[];
  product_variants: Variant[];
};
export type Category = { id: string; name: string; sort_order: number };
type Catalogue = { products: Product[]; categories: Category[]; savedAt: number };

const KEY = "ife.catalogue.v2";

export const variantPrice = (p: Product, v: Variant) => v.price_override ?? p.price;
export const totalStock = (p: Product) => p.product_variants.reduce((n, v) => n + v.quantity, 0);

function readCache(): Catalogue | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Catalogue) : null;
  } catch {
    return null;
  }
}

export async function fetchCatalogue(): Promise<Catalogue> {
  const sb = supabaseBrowser();
  const [p, c] = await Promise.all([
    sb
      .from("products")
      .select(
        "id,name,price,category_id,description,product_images(provider,path,thumb_path,sort_order),product_variants(id,size,colour,sku,price_override,quantity,low_stock_threshold,active)",
      )
      .eq("archived", false)
      .order("name"),
    sb.from("categories").select("id,name,sort_order").eq("active", true).order("sort_order").order("name"),
  ]);
  if (p.error) throw p.error;
  if (c.error) throw c.error;
  const products = (p.data as Product[])
    .map((x) => ({
      ...x,
      product_images: [...x.product_images].sort((a, b) => a.sort_order - b.sort_order),
      product_variants: x.product_variants.filter((v) => v.active),
    }))
    .filter((x) => x.product_variants.length > 0);
  const cat = { products, categories: c.data as Category[], savedAt: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(cat));
  } catch {
    /* storage full: fine */
  }
  return cat;
}

export function useCatalogue() {
  const [data, setData] = useState<Catalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchCatalogue());
      setError(null);
    } catch (e) {
      setError(navigator.onLine ? (e as Error).message : "No internet – showing saved product list.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Show the saved list immediately (fast on slow data), then refresh. Reading localStorage must
    // happen after mount (it does not exist on the server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(readCache());
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return { data, loading, error, refresh };
}
