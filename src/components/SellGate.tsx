import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionStatus } from "@/lib/supabase/server";

/**
 * Staff can only sell after today's opening stock count, and not after closing.
 * (The database enforces the same rule when a sale is saved; this just sends them to the right screen.)
 */
export async function SellGate({ children }: { children: ReactNode }) {
  const status = await getSessionStatus();
  if (status.role !== "staff") return <>{children}</>;
  if (!status.opening_done) redirect("/count/opening");
  if (status.closing_done) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-5xl">🌙</p>
        <h1 className="mt-3 text-2xl font-bold">You have closed for today</h1>
        <p className="mt-2 text-muted">Your closing is recorded. Sales open again after tomorrow&apos;s opening count.</p>
        <Link href="/my-sales" className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-brand-700 px-6 font-semibold text-white">
          See my sales today
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
