import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CartProvider } from "@/components/CartProvider";
import { getSessionStatus } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const status = await getSessionStatus();
  if (!status.signed_in || !status.allowed || !status.user_id) redirect("/login");

  return (
    <CartProvider userId={status.user_id}>
      <AppShell status={status}>{children}</AppShell>
    </CartProvider>
  );
}
