"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { SessionStatus } from "@/lib/session";
import { Icon, type IconName } from "./icons";
import { LogoutButton } from "./LogoutButton";
import { SessionGuard } from "./SessionGuard";
import { cx } from "./ui";

type NavItem = { href: string; label: string; icon: IconName; exact?: boolean };

const STAFF_NAV: NavItem[] = [
  { href: "/sell", label: "Sell", icon: "bag" },
  { href: "/count", label: "Count", icon: "list" },
  { href: "/my-sales", label: "My sales", icon: "receipt" },
];
const ADMIN_BOTTOM: NavItem[] = [
  { href: "/admin", label: "Home", icon: "home", exact: true },
  { href: "/sell", label: "Sell", icon: "bag" },
  { href: "/admin/products", label: "Products", icon: "box" },
  { href: "/admin/sales", label: "Sales", icon: "receipt" },
  { href: "/admin/more", label: "More", icon: "more" },
];
const ADMIN_SIDE: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "home", exact: true },
  { href: "/sell", label: "Sell", icon: "bag" },
  { href: "/admin/products", label: "Products & stock", icon: "box" },
  { href: "/admin/sales", label: "Sales", icon: "receipt" },
  { href: "/admin/counts", label: "Stock counts", icon: "list" },
  { href: "/admin/staff", label: "Staff", icon: "users" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
  { href: "/admin/activity", label: "Activity log", icon: "activity" },
];

export function AppShell({ status, children }: { status: SessionStatus; children: ReactNode }) {
  const pathname = usePathname();
  const isAdmin = status.role === "admin";
  const bottom = isAdmin ? ADMIN_BOTTOM : STAFF_NAV;
  const side = isAdmin ? ADMIN_SIDE : STAFF_NAV;
  const active = (i: NavItem) =>
    i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`) ||
      (i.href === "/admin/more" && /^\/admin\/(staff|settings|activity|more|counts)/.test(pathname));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr] print:block">
      {/* PC sidebar */}
      <aside className="print:hidden sticky top-0 hidden h-dvh flex-col bg-brand-900 text-white lg:flex">
        <div className="px-5 py-5">
          <p className="text-xl font-bold">IfeCollection</p>
          <p className="truncate text-sm text-brand-200">{status.full_name}</p>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {side.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={cx(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 font-semibold",
                active(i) ? "bg-white text-brand-800" : "text-white/90 hover:bg-white/10",
              )}
            >
              <Icon name={i.icon} className="size-5" />
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="p-3">
          <LogoutButton className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 font-semibold text-white/90 hover:bg-white/10">
            <Icon name="logout" className="size-5" /> Log out
          </LogoutButton>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <SessionGuard initial={status} />
        {/* Phone top bar */}
        <header className="print:hidden sticky top-0 z-30 flex h-12 items-center justify-between bg-brand-800 px-4 text-white lg:hidden">
          <span className="text-lg font-bold">IfeCollection</span>
          <span className="max-w-[45%] truncate text-sm text-brand-100">{status.full_name}</span>
        </header>

        <main className="flex-1 pb-24 lg:pb-8">{children}</main>

        {/* Phone bottom navigation */}
        <nav
          aria-label="Main"
          className="print:hidden pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white lg:hidden"
        >
          <ul className="flex">
            {bottom.map((i) => (
              <li key={i.href} className="flex-1">
                <Link
                  href={i.href}
                  aria-current={active(i) ? "page" : undefined}
                  className={cx(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold",
                    active(i) ? "text-brand-700" : "text-muted",
                  )}
                >
                  <Icon name={i.icon} />
                  {i.label}
                </Link>
              </li>
            ))}
            {!isAdmin && (
              <li className="flex-1">
                <LogoutButton className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-semibold text-muted">
                  <Icon name="logout" />
                  Log out
                </LogoutButton>
              </li>
            )}
          </ul>
        </nav>
      </div>
    </div>
  );
}
