"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert, Button, Chip, Field, inputClass } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { formatNaira, parseNaira, variantLabel } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PRODUCT_BUCKET } from "@/lib/supabase/env";
import { deleteCloudinaryImages } from "./actions";
import { PhotoPicker, photoFromExisting, type ExistingImage, type Photo } from "./PhotoPicker";

const SIZE_PRESETS = ["S", "M", "L", "XL", "XXL"];
const COLOUR_PRESETS = ["Black", "White", "Red", "Blue", "Green", "Yellow", "Pink", "Purple", "Brown", "Gold", "Multi"];

export type FormVariant = {
  id: string;
  size: string;
  colour: string;
  sku: string | null;
  price_override: number | null;
  quantity: number;
  low_stock_threshold: number;
};
export type FormProduct = {
  id: string;
  name: string;
  price: number;
  category_id: string | null;
  description: string | null;
  images: ExistingImage[];
  variants: FormVariant[];
};

const k = (colour: string, size: string) => `${colour}|${size}`;
const uniq = (xs: string[]) => [...new Set(xs)];

export function ProductForm({
  categories: initialCategories,
  product,
}: {
  categories: { id: string; name: string }[];
  product?: FormProduct;
}) {
  const router = useRouter();
  const existing = useMemo(() => new Map((product?.variants ?? []).map((v) => [k(v.colour, v.size), v])), [product]);

  const [name, setName] = useState(product?.name ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [categoryId, setCategoryId] = useState(product?.category_id ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categories, setCategories] = useState(initialCategories);
  const [newCategory, setNewCategory] = useState("");

  const [sizes, setSizes] = useState<string[]>(() => uniq((product?.variants ?? []).map((v) => v.size)).filter(Boolean));
  const [colours, setColours] = useState<string[]>(() =>
    uniq((product?.variants ?? []).map((v) => v.colour)).filter(Boolean),
  );
  const [customSize, setCustomSize] = useState("");
  const [customColour, setCustomColour] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<Record<string, { price: string; threshold: string }>>(() =>
    Object.fromEntries(
      (product?.variants ?? []).map((v) => [
        k(v.colour, v.size),
        { price: v.price_override != null ? String(v.price_override) : "", threshold: String(v.low_stock_threshold) },
      ]),
    ),
  );
  const [photos, setPhotos] = useState<Photo[]>(() =>
    [...(product?.images ?? [])].sort((a, b) => a.sort_order - b.sort_order).map(photoFromExisting),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rowColours = colours.length ? colours : [""];
  const colSizes = sizes.length ? sizes : [""];
  const combos = rowColours.flatMap((c) => colSizes.map((s) => ({ colour: c, size: s, key: k(c, s) })));

  const toggle = (list: string[], set: (x: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function addCategory() {
    const n = newCategory.trim();
    if (!n) return;
    const { data, error } = await supabaseBrowser().from("categories").insert({ name: n }).select("id,name").single();
    if (error) return setError(error.message.includes("duplicate") ? "That category already exists." : error.message);
    setCategories((c) => [...c, data]);
    setCategoryId(data.id);
    setNewCategory("");
  }

  async function save() {
    setError(null);
    const priceN = parseNaira(price);
    if (!name.trim()) return setError("Enter the product name.");
    if (priceN == null) return setError("Enter the price in naira, e.g. 12500.");
    if (photos.some((p) => p.status === "uploading" || p.status === "processing"))
      return setError("Please wait for the photos to finish uploading.");
    if (photos.some((p) => p.status === "error")) return setError("A photo failed to upload. Tap Retry or Remove it.");

    const variants = combos.map(({ colour, size, key }) => {
      const ex = existing.get(key);
      const extra = extras[key];
      const override = extra?.price ? parseNaira(extra.price) : null;
      return {
        id: ex?.id,
        size,
        colour,
        sku: ex?.sku ?? null,
        price_override: override,
        low_stock_threshold: extra?.threshold ? Number(extra.threshold) : 3,
        quantity: ex ? undefined : Number(qty[key] || 0),
      };
    });

    setSaving(true);
    const sb = supabaseBrowser();
    try {
      const { data: id, error: saveErr } = await sb.rpc("save_product", {
        p: {
          id: product?.id,
          name: name.trim(),
          price: priceN,
          category_id: categoryId || null,
          description: description.trim() || null,
          variants,
        },
      });
      if (saveErr) throw saveErr;
      const productId = id as string;

      // Photos: remove deleted ones, add new ones, save order.
      const keptIds = new Set(photos.filter((p) => p.existingId).map((p) => p.existingId));
      const removed = (product?.images ?? []).filter((img) => !keptIds.has(img.id));
      if (removed.length) {
        await sb.from("product_images").delete().in("id", removed.map((r) => r.id));
        const fromSupabase = removed.filter((r) => r.provider !== "cloudinary");
        const fromCloudinary = removed.filter((r) => r.provider === "cloudinary" && r.external_id);
        if (fromSupabase.length) {
          await sb.storage
            .from(PRODUCT_BUCKET)
            .remove(fromSupabase.flatMap((r) => [r.path, r.thumb_path].filter((x): x is string => !!x)));
        }
        if (fromCloudinary.length) {
          await deleteCloudinaryImages(fromCloudinary.map((r) => r.external_id!)).catch(() => {});
        }
      }
      const fresh = photos
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => !p.existingId && p.status === "done" && p.path && (p.provider === "cloudinary" || p.thumbPath));
      if (fresh.length) {
        const { error: imgErr } = await sb.from("product_images").insert(
          fresh.map(({ p, i }) => ({
            product_id: productId,
            provider: p.provider ?? "supabase",
            path: p.path,
            thumb_path: p.provider === "cloudinary" ? null : p.thumbPath,
            external_id: p.externalId ?? null,
            sort_order: i,
          })),
        );
        if (imgErr) throw imgErr;
      }
      await Promise.all(
        photos
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p.existingId)
          .map(({ p, i }) => sb.from("product_images").update({ sort_order: i }).eq("id", p.existingId!)),
      );
      try {
        localStorage.removeItem("ife.catalogue.v2");
      } catch {}
      router.replace(`/admin/products/${productId}?saved=1`);
      router.refresh();
    } catch (e) {
      setError(friendlyError(e).message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 pb-28">
      <section className="space-y-2 rounded-2xl bg-white p-4">
        <h2 className="font-bold">Photos</h2>
        <PhotoPicker photos={photos} setPhotos={setPhotos} />
        <p className="text-sm text-muted">Photos are made smaller on your phone before upload to save data.</p>
      </section>

      <section className="space-y-4 rounded-2xl bg-white p-4">
        <Field label="Product name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ankara wrap gown" />
        </Field>
        <Field label="Price (₦)" hint={parseNaira(price) != null ? formatNaira(parseNaira(price)) : undefined}>
          <input
            className={inputClass}
            inputMode="numeric"
            pattern="[0-9]*"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="12500"
          />
        </Field>
        <Field label="Category">
          <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="New category name"
            aria-label="New category name"
          />
          <Button type="button" variant="secondary" onClick={addCategory} disabled={!newCategory.trim()}>
            Add
          </Button>
        </div>
        <Field label="Description (optional)">
          <textarea className={`${inputClass} min-h-20 py-2`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </section>

      <section className="space-y-3 rounded-2xl bg-white p-4">
        <h2 className="font-bold">Sizes</h2>
        <div className="flex flex-wrap gap-2">
          {uniq([...SIZE_PRESETS, ...sizes]).map((s) => (
            <Chip key={s} selected={sizes.includes(s)} onClick={() => toggle(sizes, setSizes, s)}>
              {s}
            </Chip>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={customSize}
            onChange={(e) => setCustomSize(e.target.value)}
            placeholder="Other size, e.g. 42 or 3XL"
            aria-label="Custom size"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!customSize.trim()}
            onClick={() => {
              setSizes(uniq([...sizes, customSize.trim().toUpperCase()]));
              setCustomSize("");
            }}
          >
            Add
          </Button>
        </div>
        {!sizes.length && <p className="text-sm text-muted">No size chosen = &quot;One size&quot;.</p>}

        <h2 className="pt-2 font-bold">Colours</h2>
        <div className="flex flex-wrap gap-2">
          {uniq([...COLOUR_PRESETS, ...colours]).map((c) => (
            <Chip key={c} selected={colours.includes(c)} onClick={() => toggle(colours, setColours, c)}>
              {c}
            </Chip>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={customColour}
            onChange={(e) => setCustomColour(e.target.value)}
            placeholder="Other colour"
            aria-label="Custom colour"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!customColour.trim()}
            onClick={() => {
              const c = customColour.trim();
              setColours(uniq([...colours, c.charAt(0).toUpperCase() + c.slice(1)]));
              setCustomColour("");
            }}
          >
            Add
          </Button>
        </div>
      </section>

      <section className="space-y-2 rounded-2xl bg-white p-4">
        <h2 className="font-bold">{product ? "Stock for new sizes/colours" : "How many of each?"}</h2>
        {product && <p className="text-sm text-muted">Existing stock is shown in grey. Change it with Restock below.</p>}
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="border-separate border-spacing-1">
            <thead>
              <tr>
                <th />
                {colSizes.map((s) => (
                  <th key={s} className="min-w-14 text-center text-sm font-bold">
                    {s || "One size"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowColours.map((c) => (
                <tr key={c}>
                  <th className="pr-2 text-left text-sm font-bold">{c || "Qty"}</th>
                  {colSizes.map((s) => {
                    const key = k(c, s);
                    const ex = existing.get(key);
                    return (
                      <td key={key}>
                        {ex ? (
                          <div className="grid h-12 w-14 place-items-center rounded-xl bg-canvas font-semibold text-muted" title="Current stock">
                            {ex.quantity}
                          </div>
                        ) : (
                          <input
                            aria-label={`Quantity ${variantLabel(s, c)}`}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            className="h-12 w-14 rounded-xl border-2 border-line text-center text-lg font-semibold outline-none focus:border-brand-600"
                            value={qty[key] ?? ""}
                            placeholder="0"
                            onChange={(e) => setQty({ ...qty, [key]: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="rounded-xl border-2 border-line">
          <summary className="flex min-h-12 items-center px-3 font-semibold">Different price or low-stock alert per variant ▸</summary>
          <ul className="divide-y divide-line">
            {combos.map(({ colour, size, key }) => (
              <li key={key} className="grid grid-cols-[1fr_7rem_5rem] items-center gap-2 px-3 py-2">
                <span className="text-sm font-semibold">{variantLabel(size, colour)}</span>
                <input
                  aria-label={`Price for ${variantLabel(size, colour)}`}
                  inputMode="numeric"
                  placeholder="Same"
                  className="h-11 rounded-lg border-2 border-line px-2"
                  value={extras[key]?.price ?? ""}
                  onChange={(e) =>
                    setExtras({ ...extras, [key]: { threshold: extras[key]?.threshold ?? "3", price: e.target.value.replace(/\D/g, "") } })
                  }
                />
                <input
                  aria-label={`Low stock alert for ${variantLabel(size, colour)}`}
                  inputMode="numeric"
                  className="h-11 rounded-lg border-2 border-line px-2"
                  value={extras[key]?.threshold ?? "3"}
                  onChange={(e) =>
                    setExtras({ ...extras, [key]: { price: extras[key]?.price ?? "", threshold: e.target.value.replace(/\D/g, "") } })
                  }
                />
              </li>
            ))}
          </ul>
          <p className="px-3 pb-3 text-xs text-muted">Price: leave empty to use the main price. Alert: warn when stock is at or below this number.</p>
        </details>
      </section>

      {error && <Alert>{error}</Alert>}

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-white/95 p-3 backdrop-blur lg:bottom-0 lg:left-60">
        <Button size="lg" className="mx-auto w-full max-w-3xl" onClick={save} loading={saving}>
          Save product
        </Button>
      </div>
    </div>
  );
}
