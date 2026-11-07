"use client";
import { useActionState, useState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { login, type LoginState } from "./actions";

export function LoginForm({ notice }: { notice: string | null }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [show, setShow] = useState(false);
  const message = state.error ?? notice;

  return (
    <form action={action} className="space-y-4" noValidate>
      {message && <Alert kind={state.closed || notice ? "warning" : "error"}>{message}</Alert>}
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
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Log in
      </Button>
      <p className="text-center text-sm text-muted">No account? Ask the shop owner to create one for you.</p>
    </form>
  );
}
