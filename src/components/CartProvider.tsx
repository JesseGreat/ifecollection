"use client";
// The cart lives on the phone (localStorage, per user) so it survives bad network, reloads and app switches.
// Each cart has an idempotency key; it only changes after a sale is saved, so retries can never double-sell.
import { uuid } from "@/lib/uuid";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CartItem = {
  variantId: string;
  productId: string;
  name: string;
  size: string;
  colour: string;
  unitPrice: number;
  qty: number;
  maxQty: number;
  /** Ready-to-use thumbnail URL. */
  thumb: string | null;
};
type Cart = { items: CartItem[]; key: string };

type CartApi = {
  items: CartItem[];
  idempotencyKey: string;
  count: number;
  total: number;
  add: (item: Omit<CartItem, "qty">, qty: number) => void;
  setQty: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
  /** Call only after the server confirmed the sale. Starts a new cart with a new key. */
  reset: () => void;
  /** Refresh prices / stock limits from the latest catalogue. */
  sync: (lookup: (variantId: string) => { unitPrice: number; maxQty: number } | null) => void;
};

const CartContext = createContext<CartApi | null>(null);

const newKey = uuid;

export function CartProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const storageKey = `ife.cart.${userId}`;
  const [cart, setCart] = useState<Cart>({ items: [], key: "" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let saved: Cart | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCart(saved && Array.isArray(saved.items) && saved.key ? saved : { items: [], key: newKey() });
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart, loaded, storageKey]);

  const add = useCallback<CartApi["add"]>((item, qty) => {
    setCart((c) => {
      const existing = c.items.find((i) => i.variantId === item.variantId);
      const items = existing
        ? c.items.map((i) =>
            i.variantId === item.variantId ? { ...i, ...item, qty: Math.min(item.maxQty, i.qty + qty) } : i,
          )
        : [...c.items, { ...item, qty: Math.min(item.maxQty, qty) }];
      return { ...c, items: items.filter((i) => i.qty > 0) };
    });
  }, []);

  const setQty = useCallback<CartApi["setQty"]>((variantId, qty) => {
    setCart((c) => ({
      ...c,
      items: c.items
        .map((i) => (i.variantId === variantId ? { ...i, qty: Math.min(i.maxQty, Math.max(0, qty)) } : i))
        .filter((i) => i.qty > 0),
    }));
  }, []);

  const remove = useCallback((variantId: string) => {
    setCart((c) => ({ ...c, items: c.items.filter((i) => i.variantId !== variantId) }));
  }, []);

  const reset = useCallback(() => setCart({ items: [], key: newKey() }), []);

  const sync = useCallback<CartApi["sync"]>((lookup) => {
    setCart((c) => ({
      ...c,
      items: c.items.map((i) => {
        const latest = lookup(i.variantId);
        return latest ? { ...i, unitPrice: latest.unitPrice, maxQty: latest.maxQty } : i;
      }),
    }));
  }, []);

  const api = useMemo<CartApi>(
    () => ({
      items: cart.items,
      idempotencyKey: cart.key,
      count: cart.items.reduce((n, i) => n + i.qty, 0),
      total: cart.items.reduce((n, i) => n + i.qty * i.unitPrice, 0),
      add,
      setQty,
      remove,
      reset,
      sync,
    }),
    [cart, add, setQty, remove, reset, sync],
  );

  return <CartContext value={api}>{children}</CartContext>;
}

export function useCart() {
  const c = useContext(CartContext);
  if (!c) throw new Error("useCart must be used inside CartProvider");
  return c;
}
