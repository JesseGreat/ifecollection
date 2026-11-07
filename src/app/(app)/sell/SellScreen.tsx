"use client";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useCart } from "@/components/CartProvider";
import { Icon } from "@/components/icons";
import { Alert, Button, Chip, cx, Sheet, Skeleton, Stepper } from "@/components/ui";
import { totalStock, useCatalogue, variantPrice, type Product } from "@/lib/catalogue";
import { formatNaira } from "@/lib/format";
import { imageUrl } from "@/lib/images";

export function SellScreen() {
  const { data, loading, error, refresh } = useCatalogue();
  const cart = useCart();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [picked, setPicked] = useState<Product | null>(null);
  const query = useDeferredValue(q.trim().toLowerCase());

  // Keep cart prices / stock limits in line with the latest product list.
  const { sync } = cart;
  useEffect(() => {
    if (!data) return;
    const byId = new Map(data.products.flatMap((p) => p.product_variants.map((v) => [v.id, { p, v }] as const)));
    sync((id) => {
      const hit = byId.get(id);
      return hit ? { unitPrice: variantPrice(hit.p, hit.v), maxQty: hit.v.quantity } : null;
    });
  }, [data, sync]);

  const products = useMemo(() => {
    const list = data?.products ?? [];
    return list.filter(
      (p) =>
        (!cat || p.category_id === cat) &&
        (!query ||
          p.name.toLowerCase().includes(query) ||
          p.product_variants.some((v) => (v.sku ?? "").toLowerCase().includes(query) || v.colour.toLowerCase() === query)),
    );
  }, [data, cat, query]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="sticky top-12 z-20 space-y-2 bg-canvas px-4 pt-3 pb-2 lg:top-0 lg:px-8">
        <label className="relative block">
          <span className="sr-only">Search products</span>
          <Icon name="search" className="pointer-events-none absolute top-3.5 left-3 size-5 text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, colour or code"
            enterKeyHint="search"
            className="min-h-12 w-full rounded-xl border-2 border-line bg-white pr-3 pl-10 outline-none focus:border-brand-600"
          />
        </label>
        {!!data?.categories.length && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            <Chip selected={!cat} onClick={() => setCat(null)}>
              All
            </Chip>
            {data.categories.map((c) => (
              <Chip key={c.id} selected={cat === c.id} onClick={() => setCat(cat === c.id ? null : c.id)}>
                {c.name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pb-32 lg:px-8">
        {error && (
          <div className="mb-3">
            <Alert kind="warning">
              {error}{" "}
              <button className="font-bold underline" onClick={refresh}>
                Try again
              </button>
            </Alert>
          </div>
        )}

        {!data && loading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="rounded-2xl bg-white p-2">
                <Skeleton className="aspect-square" />
                <Skeleton className="mt-2 h-4" />
                <Skeleton className="mt-1 h-4 w-1/2" />
              </div>
            ))}
          </div>
        )}

        {data && products.length === 0 && (
          <p className="py-12 text-center text-muted">{query || cat ? "No product matches your search." : "No products yet."}</p>
        )}

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {products.map((p) => {
            const stock = totalStock(p);
            const prices = p.product_variants.map((v) => variantPrice(p, v));
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            const img = p.product_images[0];
            return (
              <li key={p.id}>
                <button
                  onClick={() => setPicked(p)}
                  className="flex w-full flex-col overflow-hidden rounded-2xl bg-white text-left shadow-sm active:scale-[0.98]"
                  aria-label={`${p.name}, ${formatNaira(min)}, ${stock} in stock`}
                >
                  <div className="relative aspect-square w-full bg-canvas">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl(img, "thumb")}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="grid size-full place-items-center font-serif text-3xl font-bold text-brand-200">Ife</div>
                    )}
                    {stock === 0 && (
                      <span className="absolute inset-0 grid place-items-center bg-white/70 text-lg font-bold text-red-800">Sold out</span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="line-clamp-2 min-h-10 text-sm leading-5 font-semibold">{p.name}</p>
                    <p className="text-base font-bold text-brand-800">
                      {formatNaira(min)}
                      {max > min && <span className="text-sm font-semibold"> – {formatNaira(max)}</span>}
                    </p>
                    <p className={cx("text-xs font-semibold", stock <= 3 ? "text-red-800" : "text-muted")}>{stock} in stock</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {picked && <VariantSheet product={picked} onClose={() => setPicked(null)} />}

      {cart.count > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 p-3 lg:bottom-0 lg:left-60">
          <Link
            href="/sell/checkout"
            data-testid="cart-bar"
            className="mx-auto flex min-h-14 max-w-3xl items-center justify-between rounded-2xl bg-ink px-4 text-white shadow-xl"
          >
            <span className="font-semibold">
              {cart.count} item{cart.count === 1 ? "" : "s"}
            </span>
            <span className="text-lg font-bold">{formatNaira(cart.total)}</span>
            <span className="flex items-center gap-1 font-semibold text-gold-300">
              Checkout <Icon name="chevron" className="size-5" />
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

function VariantSheet({ product, onClose }: { product: Product; onClose: () => void }) {
  const cart = useCart();
  const variants = product.product_variants;
  const colours = [...new Set(variants.map((v) => v.colour))];
  const sizes = [...new Set(variants.map((v) => v.size))];
  const inCart = (id: string) => cart.items.find((i) => i.variantId === id)?.qty ?? 0;
  const available = (id: string, qty: number) => qty - inCart(id);

  const firstInStock = variants.find((v) => available(v.id, v.quantity) > 0) ?? variants[0];
  const [colour, setColour] = useState(firstInStock.colour);
  const [size, setSize] = useState(firstInStock.size);
  const [qty, setQty] = useState(1);
  const [photo, setPhoto] = useState(0);

  const variant = variants.find((v) => v.colour === colour && v.size === size);
  const left = variant ? available(variant.id, variant.quantity) : 0;
  const price = variant ? variantPrice(product, variant) : product.price;
  const img = product.product_images[photo];

  function chooseColour(c: string) {
    setColour(c);
    setQty(1);
    if (!variants.some((v) => v.colour === c && v.size === size && available(v.id, v.quantity) > 0)) {
      const alt = variants.find((v) => v.colour === c && available(v.id, v.quantity) > 0);
      if (alt) setSize(alt.size);
    }
  }

  function add() {
    if (!variant || left <= 0) return;
    cart.add(
      {
        variantId: variant.id,
        productId: product.id,
        name: product.name,
        size: variant.size,
        colour: variant.colour,
        unitPrice: price,
        maxQty: variant.quantity,
        thumb: imageUrl(product.product_images[0], "thumb") || null,
      },
      Math.min(qty, left),
    );
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={product.name}
      footer={
        <Button size="lg" className="w-full" onClick={add} disabled={!variant || left <= 0}>
          {left <= 0 ? "Out of stock" : `Add to cart · ${formatNaira(price * qty)}`}
        </Button>
      }
    >
      {img && (
        <div className="mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl(img, "full")}
            alt={product.name}
            className="h-56 w-full rounded-2xl bg-canvas object-cover sm:h-72"
            style={{ backgroundImage: `url(${imageUrl(img, "thumb")})`, backgroundSize: "cover" }}
          />
          {product.product_images.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {product.product_images.map((im, i) => (
                <button
                  key={im.path}
                  onClick={() => setPhoto(i)}
                  aria-label={`Photo ${i + 1}`}
                  className={cx("size-14 shrink-0 overflow-hidden rounded-lg border-2", i === photo ? "border-brand-700" : "border-line")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(im, "thumb")} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {product.description && <p className="mb-3 text-muted">{product.description}</p>}

      {colours.length > 1 || colours[0] ? (
        <>
          <p className="mb-1 font-bold">Colour</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {colours.map((c) => {
              const any = variants.some((v) => v.colour === c && available(v.id, v.quantity) > 0);
              return (
                <Chip key={c} selected={c === colour} disabled={!any} onClick={() => chooseColour(c)}>
                  {c || "Default"}
                </Chip>
              );
            })}
          </div>
        </>
      ) : null}

      {sizes.length > 1 || sizes[0] ? (
        <>
          <p className="mb-1 font-bold">Size</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {sizes.map((s) => {
              const v = variants.find((x) => x.colour === colour && x.size === s);
              const n = v ? available(v.id, v.quantity) : 0;
              return (
                <Chip
                  key={s}
                  selected={s === size}
                  disabled={n <= 0}
                  onClick={() => {
                    setSize(s);
                    setQty(1);
                  }}
                >
                  {s || "One size"}
                </Chip>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-2xl font-bold text-brand-800">{formatNaira(price)}</p>
          <p className={cx("text-sm font-semibold", left <= 3 ? "text-red-800" : "text-muted")}>
            {left} available{variant && inCart(variant.id) ? ` (${inCart(variant.id)} in cart)` : ""}
          </p>
        </div>
        {left > 0 && <Stepper value={Math.min(qty, left)} onChange={setQty} min={1} max={left} label="quantity" />}
      </div>
    </Sheet>
  );
}
