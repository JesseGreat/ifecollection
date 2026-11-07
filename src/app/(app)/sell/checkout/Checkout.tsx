"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useCart } from "@/components/CartProvider";
import { Icon } from "@/components/icons";
import { Page, PageHeader } from "@/components/PageHeader";
import { Alert, Button, cx, Field, inputClass, Stepper } from "@/components/ui";
import { fetchCatalogue, variantPrice } from "@/lib/catalogue";
import { friendlyError } from "@/lib/errors";
import { formatNaira, METHOD_LABEL, parseNaira, variantLabel } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";

type Method = "cash" | "transfer" | "pos";
const METHODS: Method[] = ["cash", "transfer", "pos"];

export function Checkout() {
  const cart = useCart();
  const router = useRouter();
  const [method, setMethod] = useState<Method | null>(null);
  const [reference, setReference] = useState("");
  const [split, setSplit] = useState(false);
  const [amounts, setAmounts] = useState<Record<Method, string>>({ cash: "", transfer: "", pos: "" });
  const [refs, setRefs] = useState<Record<Method, string>>({ cash: "", transfer: "", pos: "" });
  const [showCustomer, setShowCustomer] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const sending = useRef(false);

  const splitPaid = METHODS.reduce((n, m) => n + (parseNaira(amounts[m]) ?? 0), 0);
  const splitLeft = cart.total - splitPaid;
  const overStock = cart.items.filter((i) => i.qty > i.maxQty);
  const ready = cart.count > 0 && overStock.length === 0 && (split ? splitLeft === 0 && splitPaid > 0 : method !== null);

  async function complete() {
    if (!ready || sending.current) return;
    setError(null);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError(friendlyError(new TypeError("Failed to fetch")));
      return;
    }
    sending.current = true;
    setBusy(true);
    const payments = split
      ? METHODS.filter((m) => (parseNaira(amounts[m]) ?? 0) > 0).map((m) => ({
          method: m,
          amount: parseNaira(amounts[m]),
          reference: refs[m].trim() || null,
        }))
      : [{ method, amount: null, reference: reference.trim() || null }];

    try {
      const { data, error } = await supabaseBrowser().rpc("create_sale", {
        p_items: cart.items.map((i) => ({ variant_id: i.variantId, qty: i.qty })),
        p_payments: payments,
        // Same key on every retry of this cart -> the server never records it twice.
        p_idempotency_key: cart.idempotencyKey,
        p_customer_name: customerName.trim() || null,
        p_customer_phone: customerPhone.trim() || null,
        p_expected_total: cart.total,
      });
      if (error) throw error;
      cart.reset();
      router.replace(`/receipt/${data.id}?new=1`);
    } catch (e) {
      const f = friendlyError(e);
      if (f.code === "STORE_CLOSED") {
        window.location.replace("/login?reason=closed");
        return;
      }
      if (f.code === "INSUFFICIENT_STOCK" || f.code === "PRICE_CHANGED" || f.code === "PRODUCT_UNAVAILABLE") {
        // Pull fresh prices/stock so the cart shows the truth.
        fetchCatalogue()
          .then((cat) => {
            const byId = new Map(cat.products.flatMap((p) => p.product_variants.map((v) => [v.id, { p, v }] as const)));
            cart.sync((id) => {
              const hit = byId.get(id);
              return hit ? { unitPrice: variantPrice(hit.p, hit.v), maxQty: hit.v.quantity } : { unitPrice: 0, maxQty: 0 };
            });
          })
          .catch(() => {});
      }
      setError(f);
      setBusy(false);
      sending.current = false;
    }
  }

  if (cart.count === 0) {
    return (
      <Page>
        <PageHeader title="Cart" back="/sell" />
        <div className="py-16 text-center">
          <p className="mb-4 text-lg text-muted">The cart is empty.</p>
          <Link href="/sell" className="inline-flex min-h-12 items-center rounded-xl bg-brand-700 px-6 font-semibold text-white">
            Choose products
          </Link>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={`Cart (${cart.count})`} back="/sell" />
      <div className="space-y-4 pb-36">
        <ul className="divide-y divide-line rounded-2xl bg-white">
          {cart.items.map((i) => (
            <li key={i.variantId} className="flex gap-3 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={i.thumb?.startsWith("http") ? i.thumb : "/icons/icon-192.png"}
                alt=""
                className="size-16 shrink-0 rounded-xl bg-canvas object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{i.name}</p>
                <p className="text-sm text-muted">
                  {variantLabel(i.size, i.colour)} · {formatNaira(i.unitPrice)}
                </p>
                {i.qty > i.maxQty && (
                  <p className="text-sm font-bold text-red-800">Only {i.maxQty} left – reduce the quantity.</p>
                )}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Stepper value={i.qty} onChange={(n) => cart.setQty(i.variantId, n)} min={0} max={Math.max(i.maxQty, 0)} label={`quantity of ${i.name}`} />
                  <p className="font-bold">{formatNaira(i.qty * i.unitPrice)}</p>
                </div>
              </div>
              <button onClick={() => cart.remove(i.variantId)} aria-label={`Remove ${i.name}`} className="grid size-11 place-items-center text-red-700">
                <Icon name="trash" className="size-5" />
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between rounded-2xl bg-white p-4">
          <span className="text-lg font-semibold">Total</span>
          <span className="text-2xl font-bold" data-testid="cart-total">
            {formatNaira(cart.total)}
          </span>
        </div>

        <section className="space-y-3 rounded-2xl bg-white p-4">
          <h2 className="font-bold">How did the customer pay?</h2>
          {!split ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    aria-pressed={method === m}
                    className={cx(
                      "min-h-16 rounded-xl border-4 text-lg font-bold",
                      method === m
                        ? { cash: "border-cash bg-cash text-white", transfer: "border-transfer bg-transfer text-white", pos: "border-pos bg-pos text-white" }[m]
                        : "border-line bg-white text-ink",
                    )}
                  >
                    {METHOD_LABEL[m]}
                  </button>
                ))}
              </div>
              {(method === "transfer" || method === "pos") && (
                <Field label={`${METHOD_LABEL[method]} reference (optional)`}>
                  <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. last 4 digits / bank" />
                </Field>
              )}
              <button className="min-h-11 font-semibold text-brand-700 underline" onClick={() => setSplit(true)}>
                Customer paid in two ways (split)
              </button>
            </>
          ) : (
            <>
              {METHODS.map((m) => (
                <div key={m} className="grid grid-cols-[6rem_1fr] items-center gap-2">
                  <span className="font-semibold">{METHOD_LABEL[m]}</span>
                  <input
                    aria-label={`${METHOD_LABEL[m]} amount`}
                    className={inputClass}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="₦0"
                    value={amounts[m]}
                    onChange={(e) => setAmounts({ ...amounts, [m]: e.target.value.replace(/\D/g, "") })}
                  />
                  {m !== "cash" && (parseNaira(amounts[m]) ?? 0) > 0 && (
                    <input
                      aria-label={`${METHOD_LABEL[m]} reference`}
                      className={`${inputClass} col-start-2`}
                      placeholder="Reference (optional)"
                      value={refs[m]}
                      onChange={(e) => setRefs({ ...refs, [m]: e.target.value })}
                    />
                  )}
                </div>
              ))}
              <p className={cx("rounded-xl p-3 font-bold", splitLeft === 0 ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-950")}>
                {splitLeft === 0
                  ? "Amounts match the total ✓"
                  : splitLeft > 0
                    ? `Still to pay: ${formatNaira(splitLeft)}`
                    : `Too much by ${formatNaira(-splitLeft)}`}
              </p>
              <button className="min-h-11 font-semibold text-brand-700 underline" onClick={() => setSplit(false)}>
                Back to one payment method
              </button>
            </>
          )}
        </section>

        <section className="rounded-2xl bg-white">
          <button className="flex min-h-12 w-full items-center justify-between px-4 font-bold" onClick={() => setShowCustomer((s) => !s)} aria-expanded={showCustomer}>
            Customer details (optional) <span>{showCustomer ? "▾" : "▸"}</span>
          </button>
          {showCustomer && (
            <div className="space-y-3 px-4 pb-4">
              <Field label="Name">
                <input className={inputClass} value={customerName} onChange={(e) => setCustomerName(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Phone">
                <input
                  className={inputClass}
                  type="tel"
                  inputMode="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="0803 000 0000"
                  autoComplete="off"
                />
              </Field>
            </div>
          )}
        </section>

        {error && (
          <Alert kind={error.code === "OFFLINE" ? "warning" : "error"}>
            <span data-testid="sale-error">{error.message}</span>
          </Alert>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-white/95 p-3 backdrop-blur lg:bottom-0 lg:left-60">
        <Button size="lg" className="mx-auto w-full max-w-3xl" onClick={complete} loading={busy} disabled={!ready}>
          {busy
            ? "Saving sale…"
            : ready
              ? `Complete sale · ${split ? "Split" : METHOD_LABEL[method!]} · ${formatNaira(cart.total)}`
              : split
                ? "Amounts must match the total"
                : "Choose Cash, Transfer or POS"}
        </Button>
      </div>
    </Page>
  );
}
