"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { Alert, Button, Field, inputClass, Sheet } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { receiptImage, receiptText, whatsappNumber, type ReceiptData } from "@/lib/receipt";
import { supabaseBrowser } from "@/lib/supabase/client";

export function ReceiptActions({ r }: { r: ReceiptData }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function shareImage() {
    setBusy(true);
    setMsg(null);
    try {
      const blob = await receiptImage(r);
      const file = new File([blob], `IfeCollection-${r.receipt_no}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `IfeCollection receipt ${r.receipt_no}` });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        setMsg("Receipt image saved. Share it from your photos/downloads.");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg("Could not share. Try the WhatsApp button.");
    } finally {
      setBusy(false);
    }
  }

  const wa = whatsappNumber(r.customer_phone);
  const waUrl = `https://wa.me/${wa ?? ""}?text=${encodeURIComponent(receiptText(r))}`;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={shareImage} loading={busy}>
          <Icon name="share" className="size-5" /> Share
        </Button>
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#128C4A] font-semibold text-white"
        >
          WhatsApp
        </a>
      </div>
      <Button variant="secondary" className="w-full" onClick={() => window.print()}>
        <Icon name="print" className="size-5" /> Print
      </Button>
      {msg && <Alert kind="info">{msg}</Alert>}
    </>
  );
}

export function VoidSale({ saleId, receiptNo }: { saleId: string; receiptNo: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().rpc("void_sale", { p_sale_id: saleId, p_reason: reason });
    setBusy(false);
    if (error) return setError(friendlyError(error).message);
    try {
      localStorage.removeItem("ife.catalogue.v2");
    } catch {}
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" className="w-full text-red-700" onClick={() => setOpen(true)}>
        Void this sale
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Void ${receiptNo}?`}
        footer={
          <Button variant="danger" size="lg" className="w-full" onClick={submit} loading={busy} disabled={reason.trim().length < 3}>
            Void sale and return items to stock
          </Button>
        }
      >
        <p className="mb-3">The sale stays in the records, marked VOIDED. All items go back into stock.</p>
        <Field label="Reason (required)">
          <textarea className={`${inputClass} min-h-24 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer returned the item" />
        </Field>
        {error && (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        )}
      </Sheet>
    </>
  );
}
