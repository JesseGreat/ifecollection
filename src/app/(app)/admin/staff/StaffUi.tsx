"use client";
import { useActionState, useState, useTransition } from "react";
import { Alert, Button, Field, inputClass, Sheet } from "@/components/ui";
import { createStaff, resetPassword, setActive, type ActionResult } from "./actions";

type Person = { id: string; username: string; full_name: string; role: string; active: boolean };

export function StaffRow({ person, isSelf }: { person: Person; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <li className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {person.full_name} {isSelf && <span className="text-sm text-muted">(you)</span>}
        </p>
        <p className="text-sm text-muted">
          {person.username} · {person.role === "admin" ? "Admin" : "Sales staff"}
          {!person.active && <span className="ml-2 rounded bg-red-700 px-1.5 text-xs font-bold text-white">OFF</span>}
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Manage
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={person.full_name}>
        <div className="space-y-4">
          <Field label="New password (min 8 characters)">
            <input className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button
            className="w-full"
            loading={pending}
            disabled={password.length < 8}
            onClick={() => start(async () => setResult(await resetPassword(person.id, password)))}
          >
            Change password
          </Button>
          {!isSelf && (
            <Button
              className="w-full"
              variant={person.active ? "danger" : "primary"}
              loading={pending}
              onClick={() => start(async () => setResult(await setActive(person.id, !person.active)))}
            >
              {person.active ? "Turn off account (cannot log in)" : "Turn account back on"}
            </Button>
          )}
          {result?.error && <Alert>{result.error}</Alert>}
          {result?.ok && <Alert kind="success">{result.ok}</Alert>}
        </div>
      </Sheet>
    </li>
  );
}

export function NewStaffForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createStaff, {});
  return (
    <form action={action} className="space-y-3 rounded-2xl bg-white p-4">
      <h2 className="text-lg font-bold">Add a person</h2>
      <Field label="Full name">
        <input name="full_name" className={inputClass} required />
      </Field>
      <Field label="Username (used to log in)" hint="Small letters/numbers, e.g. amaka">
        <input name="username" className={inputClass} autoCapitalize="none" autoCorrect="off" required />
      </Field>
      <Field label="Password (min 8 characters)">
        <input name="password" className={inputClass} autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Role">
        <select name="role" className={inputClass} defaultValue="staff">
          <option value="staff">Sales staff (phone, shop hours only)</option>
          <option value="admin">Admin (full access)</option>
        </select>
      </Field>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        Create account
      </Button>
    </form>
  );
}
