import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { Icon, type IconName } from "@/components/icons";
import { Page, PageHeader } from "@/components/PageHeader";

export const metadata = { title: "More" };

const LINKS: { href: string; label: string; icon: IconName; hint: string }[] = [
  { href: "/admin/counts", label: "Stock counts", icon: "list", hint: "Opening & closing counts per sales person, differences" },
  { href: "/admin/staff", label: "Staff", icon: "users", hint: "Add staff, reset passwords, turn accounts off" },
  { href: "/admin/settings", label: "Settings", icon: "settings", hint: "Working hours, receipt, categories" },
  { href: "/admin/activity", label: "Activity log", icon: "activity", hint: "Logins, voids, stock and price changes" },
  { href: "/my-sales", label: "My sales today", icon: "receipt", hint: "Sales you made yourself" },
];

export default function MorePage() {
  return (
    <Page>
      <PageHeader title="More" />
      <ul className="divide-y divide-line rounded-2xl bg-white">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex min-h-16 items-center gap-3 px-4">
              <Icon name={l.icon} className="size-6 text-brand-700" />
              <span className="flex-1">
                <span className="block font-semibold">{l.label}</span>
                <span className="block text-sm text-muted">{l.hint}</span>
              </span>
              <Icon name="chevron" className="size-5 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <LogoutButton className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-red-700">
          <Icon name="logout" /> Log out
        </LogoutButton>
      </div>
    </Page>
  );
}
