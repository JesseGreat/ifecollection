"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Admin: accept a count difference (stock is corrected by the difference, and logged) or dismiss it. */
export function ResolveLine({ lineId }: { lineId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(accept: boolean) {
    setBusy(accept ? "accept" : "dismiss");
    setError(null);
    const { error } = await supabaseBrowser().rpc("resolve_count_line", { p_line_id: lineId, p_accept: accept });
    setBusy(null);
    if (error) return setError(friendlyError(error).message);
    try {
      localStorage.removeItem("ife.catalogue.v2");
    } catch {}
    router.refresh();
  }

  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" onClick={() => resolve(true)} loading={busy === "accept"} disabled={!!busy}>
          Accept &amp; correct stock
        </Button>
        <Button size="sm" variant="secondary" onClick={() => resolve(false)} loading={busy === "dismiss"} disabled={!!busy}>
          Dismiss
        </Button>
      </div>
      {error && (
        <div className="mt-2">
          <Alert>{error}</Alert>
        </div>
      )}
    </div>
  );
}
