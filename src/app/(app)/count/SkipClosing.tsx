"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Sheet } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { supabaseBrowser } from "@/lib/supabase/client";

/** "It's late – count tomorrow": recorded, and closes this person's day. */
export function SkipClosing() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function skip() {
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().rpc("skip_closing_count", { p_reason: "Late – will count tomorrow" });
    setBusy(false);
    if (error) return setError(friendlyError(error).message);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" size="lg" onClick={() => setOpen(true)}>
        It&apos;s late – count tomorrow
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Skip closing count?"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="lg" onClick={skip} loading={busy}>
              Yes, close my day
            </Button>
          </div>
        }
      >
        <p>This is recorded for the admin. You cannot sell again today, and tomorrow&apos;s morning count will check the stock.</p>
        {error && (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        )}
      </Sheet>
    </>
  );
}
