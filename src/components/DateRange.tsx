"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { addDays } from "@/lib/format";
import { Chip } from "./ui";

/** Today / Yesterday / 7 days / This month + custom from–to. `today` comes from the server (Lagos). */
export function DateRange({ from, to, today }: { from: string; to: string; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  const go = (nf: string, nt: string) => {
    const p = new URLSearchParams(params.toString());
    p.set("from", nf);
    p.set("to", nt);
    router.push(`${pathname}?${p.toString()}`);
  };
  const monthStart = `${today.slice(0, 8)}01`;
  const presets = [
    { label: "Today", f: today, t: today },
    { label: "Yesterday", f: addDays(today, -1), t: addDays(today, -1) },
    { label: "Last 7 days", f: addDays(today, -6), t: today },
    { label: "This month", f: monthStart, t: today },
  ];

  return (
    <div className="space-y-2 print:hidden">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {presets.map((p) => (
          <Chip key={p.label} selected={from === p.f && to === p.t} onClick={() => go(p.f, p.t)}>
            {p.label}
          </Chip>
        ))}
      </div>
      <form
        className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (f && t) go(f <= t ? f : t, f <= t ? t : f);
        }}
      >
        <label className="min-w-0 text-sm font-semibold">
          From
          <input type="date" value={f} max={today} onChange={(e) => setF(e.target.value)} className="mt-1 block min-h-12 w-full min-w-0 rounded-xl border-2 border-line bg-white px-2" />
        </label>
        <label className="min-w-0 text-sm font-semibold">
          To
          <input type="date" value={t} max={today} onChange={(e) => setT(e.target.value)} className="mt-1 block min-h-12 w-full min-w-0 rounded-xl border-2 border-line bg-white px-2" />
        </label>
        <button className="col-span-2 min-h-12 rounded-xl bg-ink px-4 font-semibold text-white sm:col-span-1">Show</button>
      </form>
    </div>
  );
}
