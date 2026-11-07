import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icons";

export function PageHeader({ title, back, action }: { title: string; back?: string; action?: ReactNode }) {
  return (
    <div className="print:hidden flex min-h-14 items-center gap-2 px-4 pt-3 pb-2 lg:px-8 lg:pt-6">
      {back && (
        <Link href={back} aria-label="Back" className="-ml-2 grid size-11 place-items-center rounded-full text-brand-700">
          <Icon name="back" />
        </Link>
      )}
      <h1 className="flex-1 truncate text-xl font-bold lg:text-2xl">{title}</h1>
      {action}
    </div>
  );
}

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={`mx-auto w-full px-4 lg:px-8 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>{children}</div>;
}
