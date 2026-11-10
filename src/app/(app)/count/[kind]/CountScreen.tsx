"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Alert, Button, Chip, cx, Sheet, Skeleton, Stepper } from "@/components/ui";
import { useCatalogue } from "@/lib/catalogue";
import { friendlyError } from "@/lib/errors";
import { variantLabel } from "@/lib/format";
import { imageUrl } from "@/lib/images";
import { supabaseBrowser } from "@/lib/supabase/client";

type Line = { variant_id: string; product_name: string; size: string; colour: string; expected: number; counted: number | null };
type Count = {
  id: string;
  kind: "opening" | "closing";
  status: "in_progress" | "submitted" | "skipped";
  lines: Line[];
  summary?: { items: number; mismatches: number; missing: number; extra: number };
};
type Filter = "todo" | "different" | "all";

const TITLE = { opening: "Morning (opening) count", closing: "Evening (closing) count" };

export function CountScreen({ kind }: { kind: "opening" | "closing" }) {
  const [count, setCount] = useState<Count | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What the person has counted so far (kept on the phone, so switching apps never loses work).
  const [entries, setEntries] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todo");
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: catalogue } = useCatalogue();

  const draftKey = count ? `ife.count.${count.id}` : null;

  const load = useCallback(async () => {
    setError(null);
    const { data, error } = await supabaseBrowser().rpc("start_stock_count", { p_kind: kind });
    if (error) {
      const f = friendlyError(error);
      if (f.code === "OPENING_COUNT_REQUIRED") return window.location.replace("/count/opening");
      return setError(f.message);
    }
    setCount(data as Count);
    try {
      const saved = JSON.parse(localStorage.getItem(`ife.count.${(data as Count).id}`) ?? "{}");
      setEntries(saved && typeof saved === "object" ? saved : {});
    } catch {
      /* ignore */
    }
  }, [kind]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server on open
    load();
  }, [load]);

  useEffect(() => {
    if (!draftKey) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(entries));
    } catch {
      /* ignore */
    }
  }, [entries, draftKey]);

  const thumbs = useMemo(() => {
    const m = new Map<string, string>();
    catalogue?.products.forEach((p) => p.product_variants.forEach((v) => p.product_images[0] && m.set(v.id, imageUrl(p.product_images[0], "thumb"))));
    return m;
  }, [catalogue]);

  const lines = count?.lines ?? [];
  const done = lines.filter((l) => entries[l.variant_id] != null).length;
  const different = lines.filter((l) => entries[l.variant_id] != null && entries[l.variant_id] !== l.expected);
  const shown = lines.filter((l) => {
    // The item being edited stays on screen until "Done", even though it now counts as counted.
    if (l.variant_id === editing) return true;
    const e = entries[l.variant_id];
    if (filter === "todo" && e != null) return false;
    if (filter === "different" && (e == null || e === l.expected)) return false;
    const text = `${l.product_name} ${l.colour} ${l.size}`.toLowerCase();
    return !q.trim() || text.includes(q.trim().toLowerCase());
  });

  const set = (id: string, n: number) => setEntries((e) => ({ ...e, [id]: n }));

  async function submit() {
    if (!count) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabaseBrowser().rpc("submit_stock_count", {
      p_count_id: count.id,
      p_lines: lines.map((l) => ({ variant_id: l.variant_id, counted: entries[l.variant_id] })),
    });
    setBusy(false);
    setConfirm(false);
    if (error) return setError(friendlyError(error).message);
    try {
      localStorage.removeItem(`ife.count.${count.id}`);
    } catch {}
    setCount(data as Count);
  }

  if (error && !count) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Alert>{error}</Alert>
        <Button className="mt-4 w-full" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }
  if (!count) {
    return (
      <div className="mx-auto max-w-3xl space-y-2 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  // Finished (just now or earlier today).
  if (count.status !== "in_progress") {
    const diffs = count.lines.filter((l) => l.counted != null && l.counted !== l.expected);
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center" data-testid="count-done">
        <p className="text-5xl">{diffs.length ? "⚠️" : "✅"}</p>
        <h1 className="mt-3 text-2xl font-bold">{TITLE[count.kind]} saved</h1>
        <p className="mt-2 text-muted">
          {count.lines.length} items counted.{" "}
          {diffs.length
            ? `${diffs.length} item${diffs.length === 1 ? "" : "s"} did not match – the admin has been told.`
            : "Everything matched."}
        </p>
        {diffs.length > 0 && (
          <ul className="mt-4 divide-y divide-line rounded-2xl bg-white text-left">
            {diffs.map((l) => (
              <li key={l.variant_id} className="flex justify-between gap-2 px-4 py-2 text-sm">
                <span>
                  {l.product_name} · {variantLabel(l.size, l.colour)}
                </span>
                <b className={l.counted! < l.expected ? "text-red-800" : "text-amber-800"}>
                  {l.counted! < l.expected ? `${l.expected - l.counted!} missing` : `${l.counted! - l.expected} extra`}
                </b>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={count.kind === "opening" ? "/sell" : "/my-sales"}
          className="mt-6 flex min-h-14 items-center justify-center rounded-xl bg-brand-700 text-lg font-semibold text-white"
        >
          {count.kind === "opening" ? "Start selling" : "See my sales today"}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="sticky top-12 z-20 space-y-2 bg-canvas px-4 pt-3 pb-2 lg:top-0 lg:px-8">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">{TITLE[kind]}</h1>
          <span className="font-bold" data-testid="count-progress">
            {done} / {lines.length}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={done} aria-valuemax={lines.length}>
          <div className="h-full bg-cash transition-all" style={{ width: `${lines.length ? (done / lines.length) * 100 : 0}%` }} />
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find an item"
          aria-label="Find an item"
          className="min-h-12 w-full rounded-xl border-2 border-line bg-white px-3 outline-none focus:border-brand-600"
        />
        <div className="flex gap-2">
          <Chip selected={filter === "todo"} onClick={() => setFilter("todo")}>
            To count ({lines.length - done})
          </Chip>
          <Chip selected={filter === "different"} onClick={() => setFilter("different")}>
            Different ({different.length})
          </Chip>
          <Chip selected={filter === "all"} onClick={() => setFilter("all")}>
            All
          </Chip>
        </div>
      </div>

      <ul className="space-y-2 px-4 pb-36 lg:px-8">
        {shown.map((l) => {
          const e = entries[l.variant_id];
          const matches = e != null && e === l.expected;
          const isEditing = editing === l.variant_id;
          const label = `${l.product_name} ${variantLabel(l.size, l.colour)}`;
          return (
            <li
              key={l.variant_id}
              data-testid="count-line"
              className={cx(
                "rounded-2xl border-2 bg-white p-3",
                e == null ? "border-transparent" : matches ? "border-green-600" : "border-amber-500",
              )}
            >
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbs.get(l.variant_id) || "/icons/icon-192.png"} alt="" className="size-12 shrink-0 rounded-lg bg-canvas object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{l.product_name}</p>
                  <p className="text-sm text-muted">{variantLabel(l.size, l.colour)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted">System</p>
                  <p className="text-xl font-bold">{l.expected}</p>
                </div>
              </div>
              {e != null && !isEditing && (
                <p className={cx("mt-2 font-semibold", matches ? "text-green-800" : "text-amber-900")}>
                  {matches ? `✓ ${e} on the shelf` : `Counted ${e} (${e < l.expected ? `${l.expected - e} missing` : `${e - l.expected} extra`})`}
                </p>
              )}
              {isEditing ? (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Stepper value={e ?? l.expected} onChange={(n) => set(l.variant_id, n)} min={0} max={100000} label={`counted ${label}`} />
                  <Button size="sm" onClick={() => (set(l.variant_id, e ?? l.expected), setEditing(null))}>
                    Done
                  </Button>
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant={matches ? "cash" : "secondary"}
                    aria-label={`Correct: ${l.expected} ${label}`}
                    onClick={() => set(l.variant_id, l.expected)}
                  >
                    ✓ Correct
                  </Button>
                  <Button size="sm" variant="secondary" aria-label={`Different number for ${label}`} onClick={() => setEditing(l.variant_id)}>
                    Different
                  </Button>
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="py-10 text-center text-muted">
            {filter === "todo" ? "Everything is counted. Tap Submit below." : "Nothing here."}
          </li>
        )}
      </ul>

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-white/95 p-3 backdrop-blur lg:bottom-0 lg:left-60">
        {error && (
          <div className="mx-auto mb-2 max-w-3xl">
            <Alert>{error}</Alert>
          </div>
        )}
        <Button size="lg" className="mx-auto w-full max-w-3xl" disabled={done < lines.length} onClick={() => setConfirm(true)}>
          {done < lines.length ? `${lines.length - done} item${lines.length - done === 1 ? "" : "s"} left to count` : "Submit count"}
        </Button>
      </div>

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Submit count?"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setConfirm(false)}>
              Check again
            </Button>
            <Button size="lg" onClick={submit} loading={busy}>
              Submit
            </Button>
          </div>
        }
      >
        <p>
          {lines.length} items counted.{" "}
          {different.length ? (
            <b className="text-amber-900">{different.length} do not match the system – the admin will see this.</b>
          ) : (
            "Everything matches the system."
          )}
        </p>
        {kind === "closing" && <p className="mt-2 font-semibold">After this you cannot make more sales today.</p>}
        <p className="mt-2 text-sm text-muted">
          <Icon name="list" className="mr-1 inline size-4" />
          You cannot change a count after submitting it.
        </p>
      </Sheet>
    </div>
  );
}
