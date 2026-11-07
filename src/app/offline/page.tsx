import { RetryButton } from "./RetryButton";

export const metadata = { title: "No internet" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-2xl font-bold text-brand-800">IfeCollection</p>
      <p className="text-lg font-semibold">No internet connection</p>
      <p className="text-muted">IfeCollection needs internet to record sales. Check your data or Wi-Fi and try again.</p>
      <RetryButton />
    </main>
  );
}
