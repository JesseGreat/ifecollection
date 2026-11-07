"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, inputClass, Sheet, Stepper } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { formatNaira, variantLabel } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";

type V = { id: string; size: string; colour: string; quantity: number; low_stock_threshold: number; price_override: number | null };

export function StockPanel({ variants }: { variants: V[] }) {
  const [target, setTarget] = useState<V | null>(null);
  return (
    <section className="rounded-2xl bg-white p-4">
      <h2 className="mb-2 text-lg font-bold">Stock</h2>
      <ul className="divide-y divide-line">
        {variants.map((v) => (
          <li key={v.id} className="flex items-center gap-3 py-2">
            <div className="flex-1">
              <p className="font-semibold">{variantLabel(v.size, v.colour)}</p>
              {v.price_override != null && <p className="text-sm text-muted">{formatNaira(v.price_override)}</p>}
            </div>
            <span
              className={`min-w-12 rounded-lg px-2 py-1 text-center font-bold ${
                v.quantity === 0 ? "bg-red-700 text-white" : v.quantity <= v.low_stock_threshold ? "bg-amber-400" : "bg-canvas"
              }`}
              data-testid={`stock-${v.colour}-${v.size}`}
            >
              {v.quantity}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setTarget(v)}>
              Restock
            </Button>
          </li>
        ))}
      </ul>
      {target && <StockSheet variant={target} onClose={() => setTarget(null)} />}
    </section>
  );
}

function StockSheet({ variant, onClose }: { variant: V; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"restock" | "adjust">("restock");
  const [add, setAdd] = useState(1);
  const [count, setCount] = useState(variant.quantity);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser();
    const { error } =
      mode === "restock"
        ? await sb.rpc("restock_variant", { p_variant_id: variant.id, p_qty: add, p_note: note || null })
        : await sb.rpc("adjust_stock", { p_variant_id: variant.id, p_new_quantity: count, p_reason: note });
    setBusy(false);
    if (error) return setError(friendlyError(error).message);
    try {
      localStorage.removeItem("ife.catalogue.v2");
    } catch {}
    onClose();
    router.refresh();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Stock: ${variantLabel(variant.size, variant.colour)}`}
      footer={
        <Button size="lg" className="w-full" onClick={submit} loading={busy} disabled={mode === "adjust" && note.trim().length < 3}>
          {mode === "restock" ? `Add ${add} to stock` : `Set stock to ${count}`}
        </Button>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Button variant={mode === "restock" ? "primary" : "secondary"} onClick={() => setMode("restock")}>
          Restock (+)
        </Button>
        <Button variant={mode === "adjust" ? "primary" : "secondary"} onClick={() => setMode("adjust")}>
          Correct count
        </Button>
      </div>
      <p className="mb-3">
        Now in stock: <b>{variant.quantity}</b>
      </p>
      <div className="space-y-4">
        {mode === "restock" ? (
          <Field label="How many arrived?">
            <Stepper value={add} onChange={setAdd} min={1} max={10000} label="quantity to add" />
          </Field>
        ) : (
          <Field label="Actual count on the shelf">
            <Stepper value={count} onChange={setCount} min={0} max={100000} label="new stock count" />
          </Field>
        )}
        <Field label={mode === "restock" ? "Note (optional)" : "Reason (required)"}>
          <input
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === "restock" ? "e.g. Delivery from Balogun" : "e.g. 1 damaged, counted shelf"}
          />
        </Field>
        {error && <Alert>{error}</Alert>}
      </div>
    </Sheet>
  );
}

export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function toggle() {
    setBusy(true);
    await supabaseBrowser().from("products").update({ archived: !archived }).eq("id", id);
    try {
      localStorage.removeItem("ife.catalogue.v2");
    } catch {}
    setBusy(false);
    setConfirm(false);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => (archived ? toggle() : setConfirm(true))} loading={busy}>
        {archived ? "Unarchive" : "Archive"}
      </Button>
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Archive this product?"
        footer={
          <Button variant="danger" size="lg" className="w-full" onClick={toggle} loading={busy}>
            Yes, archive
          </Button>
        }
      >
        <p>Staff will no longer see or sell it. Past sales are kept. You can unarchive it later.</p>
      </Sheet>
    </>
  );
}
