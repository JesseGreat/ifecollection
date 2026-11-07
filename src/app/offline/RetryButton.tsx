"use client";

export function RetryButton() {
  return (
    <button
      onClick={() => location.replace("/")}
      className="min-h-12 rounded-xl bg-brand-700 px-6 text-lg font-semibold text-white"
    >
      Try again
    </button>
  );
}
