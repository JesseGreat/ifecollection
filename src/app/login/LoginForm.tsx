"use client";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { login, type LoginState } from "./actions";

type Geo = { lat: number; lng: number; accuracy: number } | { error: "denied" | "unavailable" | "timeout" | "unsupported" };

/** Ask the phone for its GPS position (Android/iPhone show their own "Allow location?" prompt). */
function getLocation(): Promise<Geo> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({ error: "unsupported" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => resolve({ error: e.code === e.PERMISSION_DENIED ? "denied" : e.code === e.TIMEOUT ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  });
}

export function LoginForm({ notice }: { notice: string | null }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [show, setShow] = useState(false);
  const [locating, setLocating] = useState(false);
  const message = state.error ?? notice;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLocating(true);
    const geo = await getLocation();
    setLocating(false);
    if ("error" in geo) form.set("geo_error", geo.error);
    else {
      form.set("lat", String(geo.lat));
      form.set("lng", String(geo.lng));
      form.set("accuracy", String(geo.accuracy));
    }
    startTransition(() => action(form));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {message && <Alert kind={state.closed || (notice && !state.error) ? "warning" : "error"}>{message}</Alert>}
      <Field label="Username">
        <input
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          className={inputClass}
        />
      </Field>
      <Field label="Password">
        <div className="relative">
          <input
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            className={`${inputClass} pr-20`}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute inset-y-0 right-0 min-w-16 px-3 text-sm font-semibold text-brand-700"
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={pending || locating}>
        {locating ? "Getting your location…" : "Log in"}
      </Button>
      <p className="text-center text-sm text-muted">
        Your location is recorded when you log in. No account? Ask the shop owner to create one for you.
      </p>
    </form>
  );
}
