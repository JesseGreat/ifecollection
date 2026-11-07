import { formatClock } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { reason } = await searchParams;
  let openTime = "08:00";
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("store_hours");
    if (data?.open_time) openTime = data.open_time;
  } catch {
    /* show default */
  }

  const notice =
    reason === "closed"
      ? `IfeCollection is closed. You can log in from ${formatClock(openTime)}.`
      : reason === "inactive"
        ? "Your account is turned off. Please ask the admin."
        : null;

  return (
    <main className="flex min-h-dvh flex-col bg-brand-800">
      <div className="flex flex-1 flex-col items-center justify-center px-6 pt-10 pb-6 text-center text-white">
        <div className="mb-3 grid size-20 place-items-center rounded-3xl bg-white/10 font-serif text-3xl font-bold">Ife</div>
        <h1 className="text-3xl font-bold tracking-tight">IfeCollection</h1>
        <p className="mt-1 text-brand-100">Sales &amp; stock</p>
      </div>
      <div className="pb-safe rounded-t-3xl bg-white px-5 pt-6 pb-8 sm:mx-auto sm:mb-10 sm:w-full sm:max-w-md sm:rounded-3xl">
        <LoginForm notice={notice} />
      </div>
    </main>
  );
}
