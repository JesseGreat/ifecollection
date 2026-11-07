import { formatDateTime, formatNaira, METHOD_LABEL, variantLabel } from "./format";

export type ReceiptData = {
  id: string;
  receipt_no: string;
  created_at: string;
  total: number;
  status: "completed" | "voided";
  void_reason: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  staff_name: string;
  items: { product_name: string; size: string; colour: string; unit_price: number; qty: number; line_total: number }[];
  payments: { method: string; amount: number; reference: string | null }[];
  store: { phone: string | null; address: string | null; footer: string };
};

/** Plain-text receipt (for WhatsApp messages). */
export function receiptText(r: ReceiptData): string {
  const lines = [
    "*IfeCollection*",
    `Receipt ${r.receipt_no}`,
    formatDateTime(r.created_at),
    "",
    ...r.items.map(
      (i) => `${i.qty} × ${i.product_name} (${variantLabel(i.size, i.colour)}) – ${formatNaira(i.line_total)}`,
    ),
    "",
    `*TOTAL: ${formatNaira(r.total)}*`,
    `Paid: ${r.payments.map((p) => `${METHOD_LABEL[p.method]} ${formatNaira(p.amount)}`).join(", ")}`,
    `Served by: ${r.staff_name}`,
  ];
  if (r.status === "voided") lines.push("", "*VOIDED*");
  if (r.store.footer) lines.push("", r.store.footer);
  return lines.join("\n");
}

/** Nigerian number -> international digits for wa.me (0803… -> 234803…). */
export function whatsappNumber(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("234") && d.length >= 12) return d;
  if (d.startsWith("0") && d.length === 11) return `234${d.slice(1)}`;
  if (d.length === 10) return `234${d}`;
  return null;
}

/** Draw the receipt as a PNG (for sharing to WhatsApp as an image). Browser only. */
export async function receiptImage(r: ReceiptData): Promise<Blob> {
  const W = 420;
  const scale = 2;
  const pad = 20;
  const lineH = 22;
  const rows: { text: string; right?: string; bold?: boolean; size?: number; center?: boolean; color?: string; gap?: number }[] = [
    { text: "IfeCollection", bold: true, size: 26, center: true, color: "#861041" },
    ...(r.store.address ? [{ text: r.store.address, center: true, size: 13 }] : []),
    ...(r.store.phone ? [{ text: r.store.phone, center: true, size: 13 }] : []),
    { text: "", gap: 6 },
    { text: `Receipt ${r.receipt_no}`, bold: true },
    { text: formatDateTime(r.created_at), size: 14 },
    { text: `Served by ${r.staff_name}`, size: 14 },
    ...(r.customer_name ? [{ text: `Customer: ${r.customer_name}`, size: 14 }] : []),
    { text: "—", gap: 4 },
    ...r.items.flatMap((i) => [
      { text: i.product_name, bold: true, size: 15 },
      { text: `  ${variantLabel(i.size, i.colour)}  ${i.qty} × ${formatNaira(i.unit_price)}`, right: formatNaira(i.line_total), size: 14 },
    ]),
    { text: "—", gap: 4 },
    { text: "TOTAL", right: formatNaira(r.total), bold: true, size: 20 },
    ...r.payments.map((p) => ({
      text: `${METHOD_LABEL[p.method]}${p.reference ? ` (${p.reference})` : ""}`,
      right: formatNaira(p.amount),
      size: 14,
    })),
    ...(r.status === "voided" ? [{ text: `VOIDED: ${r.void_reason ?? ""}`, bold: true, color: "#b91c1c" }] : []),
    { text: "", gap: 6 },
    { text: r.store.footer, center: true, size: 13 },
  ];
  const H = pad * 2 + rows.reduce((h, row) => h + (row.size ?? 16) * 1.4 + (row.gap ?? 0), 0) + lineH;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = Math.ceil(H * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  let y = pad;
  for (const row of rows) {
    const size = row.size ?? 16;
    y += size * 1.4 + (row.gap ?? 0);
    ctx.font = `${row.bold ? "700" : "400"} ${size}px system-ui, -apple-system, Roboto, Arial, sans-serif`;
    ctx.fillStyle = row.color ?? "#111114";
    if (row.text === "—") {
      ctx.strokeStyle = "#999";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad, y - size / 2);
      ctx.lineTo(W - pad, y - size / 2);
      ctx.stroke();
      continue;
    }
    ctx.textAlign = row.center ? "center" : "left";
    ctx.fillText(row.text, row.center ? W / 2 : pad, y, W - pad * 2 - (row.right ? 110 : 0));
    if (row.right) {
      ctx.textAlign = "right";
      ctx.fillText(row.right, W - pad, y);
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("image"))), "image/png"));
}
