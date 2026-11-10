"use client";
import { useState, useTransition, type ReactNode } from "react";
import { logout } from "@/app/login/actions";
import { useCart } from "./CartProvider";
import { Button, Sheet } from "./ui";

/** A "Log out" button that first asks "Are you sure?" (bottom sheet on phones, dialog on PC). */
export function LogoutButton({ className, children }: { className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const cart = useCart();

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <Sheet
        open={open}
        onClose={() => !pending && setOpen(false)}
        title="Log out?"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" size="lg" loading={pending} onClick={() => start(() => logout())}>
              Yes, log out
            </Button>
          </div>
        }
      >
        <p className="text-lg">Are you sure you want to log out of IfeCollection?</p>
        {cart.count > 0 && (
          <p className="mt-2 text-muted">
            Your cart has {cart.count} item{cart.count === 1 ? "" : "s"}. They will still be there when you log in again on this phone.
          </p>
        )}
      </Sheet>
    </>
  );
}
