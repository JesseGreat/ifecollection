"use client";
// Small UI kit. Every tappable thing is at least 44px tall; nothing depends on hover.
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost" | "cash" | "transfer" | "pos";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-700 text-white active:bg-brand-800 disabled:bg-brand-200",
  secondary: "bg-white text-ink border-2 border-line active:bg-canvas disabled:text-muted",
  danger: "bg-red-700 text-white active:bg-red-800 disabled:bg-red-200",
  ghost: "bg-transparent text-brand-700 active:bg-brand-50",
  cash: "bg-cash text-white",
  transfer: "bg-transfer text-white",
  pos: "bg-pos text-white",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors select-none",
        "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-gold-500 disabled:cursor-not-allowed",
        size === "sm" && "min-h-11 px-3 text-sm",
        size === "md" && "min-h-12 px-4 text-base",
        size === "lg" && "min-h-14 px-5 text-lg",
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-5 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
    />
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 9999,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  label: string;
}) {
  return (
    <div className="inline-flex items-center rounded-xl border-2 border-line bg-white" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        className="size-12 text-2xl font-bold text-brand-700 disabled:text-line"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        pattern="[0-9]*"
        className="h-12 w-14 border-x-2 border-line text-center text-lg font-semibold outline-none"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, "") || 0);
          onChange(Math.min(max, Math.max(min, n)));
        }}
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        className="size-12 text-2xl font-bold text-brand-700 disabled:text-line"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}

export function Chip({
  selected,
  disabled,
  onClick,
  children,
  className,
}: {
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "min-h-11 min-w-11 shrink-0 rounded-full border-2 px-4 text-base font-semibold",
        selected ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-ink",
        disabled && "border-dashed text-muted line-through opacity-60",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Bottom sheet on phones, centred dialog on PC. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center" role="dialog" aria-modal aria-label={title}>
      <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="animate-sheet-up relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl bg-white lg:rounded-3xl">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="size-11 rounded-full text-2xl text-muted">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="pb-safe border-t border-line bg-white px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-xl", className)} />;
}

export function Alert({ kind = "error", children }: { kind?: "error" | "info" | "success" | "warning"; children: ReactNode }) {
  const styles = {
    error: "bg-red-50 border-red-700 text-red-900",
    info: "bg-blue-50 border-blue-700 text-blue-950",
    success: "bg-green-50 border-green-700 text-green-950",
    warning: "bg-amber-50 border-amber-600 text-amber-950",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cx("rounded-xl border-l-4 p-3 text-base font-medium", styles)}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "block min-h-12 w-full min-w-0 rounded-xl border-2 border-line bg-white px-3 text-base text-ink outline-none focus:border-brand-600";
