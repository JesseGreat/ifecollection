"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { supabaseBrowser } from "@/lib/supabase/client";

type Settings = {
  staff_open_time: string;
  staff_close_time: string;
  warn_minutes: number;
  store_phone: string | null;
  store_address: string | null;
  receipt_footer: string;
};

export function SettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [s, setS] = useState({
    ...initial,
    staff_open_time: initial.staff_open_time.slice(0, 5),
    staff_close_time: initial.staff_close_time.slice(0, 5),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const { error } = await supabaseBrowser().rpc("update_settings", {
      p: { ...s, store_phone: s.store_phone ?? "", store_address: s.store_address ?? "" },
    });
    setBusy(false);
    if (error) return setMsg({ error: friendlyError(error).message });
    setMsg({ ok: "Settings saved." });
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-2xl bg-white p-4">
      <h2 className="text-lg font-bold">Staff working hours (Lagos time)</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Open from">
          <input type="time" className={inputClass} value={s.staff_open_time} onChange={(e) => setS({ ...s, staff_open_time: e.target.value })} />
        </Field>
        <Field label="Close at">
          <input type="time" className={inputClass} value={s.staff_close_time} onChange={(e) => setS({ ...s, staff_close_time: e.target.value })} />
        </Field>
      </div>
      <Field label="Warn staff this many minutes before closing">
        <input
          className={inputClass}
          inputMode="numeric"
          value={s.warn_minutes}
          onChange={(e) => setS({ ...s, warn_minutes: Number(e.target.value.replace(/\D/g, "") || 0) })}
        />
      </Field>
      <h2 className="pt-2 text-lg font-bold">Receipt</h2>
      <Field label="Shop phone">
        <input type="tel" inputMode="tel" className={inputClass} value={s.store_phone ?? ""} onChange={(e) => setS({ ...s, store_phone: e.target.value })} />
      </Field>
      <Field label="Shop address">
        <input className={inputClass} value={s.store_address ?? ""} onChange={(e) => setS({ ...s, store_address: e.target.value })} />
      </Field>
      <Field label="Message at the bottom of receipts">
        <input className={inputClass} value={s.receipt_footer} onChange={(e) => setS({ ...s, receipt_footer: e.target.value })} />
      </Field>
      {msg?.error && <Alert>{msg.error}</Alert>}
      {msg?.ok && <Alert kind="success">{msg.ok}</Alert>}
      <Button size="lg" className="w-full" onClick={save} loading={busy}>
        Save settings
      </Button>
    </section>
  );
}

type Cat = { id: string; name: string; sort_order: number; active: boolean };

export function CategoriesEditor({ initial }: { initial: Cat[] }) {
  const [cats, setCats] = useState(initial);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sb = supabaseBrowser();

  async function add() {
    setError(null);
    const { data, error } = await sb
      .from("categories")
      .insert({ name: name.trim(), sort_order: cats.length })
      .select("id,name,sort_order,active")
      .single();
    if (error) return setError(error.message.includes("duplicate") ? "That category already exists." : error.message);
    setCats([...cats, data]);
    setName("");
  }

  async function patch(id: string, p: Partial<Cat>) {
    setError(null);
    const { error } = await sb.from("categories").update(p).eq("id", id);
    if (error) return setError(error.message);
    setCats(cats.map((c) => (c.id === id ? { ...c, ...p } : c)));
  }

  async function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= cats.length) return;
    const next = [...cats];
    [next[i], next[j]] = [next[j], next[i]];
    setCats(next.map((c, n) => ({ ...c, sort_order: n })));
    await Promise.all(next.map((c, n) => sb.from("categories").update({ sort_order: n }).eq("id", c.id)));
  }

  return (
    <section className="space-y-3 rounded-2xl bg-white p-4">
      <h2 className="text-lg font-bold">Categories</h2>
      <ul className="divide-y divide-line">
        {cats.map((c, i) => (
          <li key={c.id} className="flex items-center gap-1 py-2">
            <input
              aria-label="Category name"
              defaultValue={c.name}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && patch(c.id, { name: e.target.value.trim() })}
              className={`min-h-11 min-w-0 flex-1 rounded-lg border-2 border-transparent px-2 font-semibold focus:border-line ${c.active ? "" : "text-muted line-through"}`}
            />
            <button aria-label="Move up" onClick={() => move(i, -1)} className="size-11 text-xl">
              ↑
            </button>
            <button aria-label="Move down" onClick={() => move(i, 1)} className="size-11 text-xl">
              ↓
            </button>
            <button onClick={() => patch(c.id, { active: !c.active })} className="min-h-11 px-2 text-sm font-semibold text-brand-700">
              {c.active ? "Hide" : "Show"}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ankara" aria-label="New category" />
        <Button variant="secondary" onClick={add} disabled={!name.trim()}>
          Add
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
    </section>
  );
}
