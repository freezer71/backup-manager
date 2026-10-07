"use client";

import { useActionState } from "react";
import { FormError } from "@/app/components/FormError";
import { SubmitButton } from "@/app/components/SubmitButton";
import type { FormState } from "@/app/login/actions";

type Action = (state: FormState, fd: FormData) => Promise<FormState>;

export function EnvironmentForm({ action, submitLabel, initial }: { action: Action; submitLabel: string; initial?: { name: string; description: string } }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5">Nom<input name="name" defaultValue={initial?.name} required /></label>
      <label className="flex min-w-48 flex-1 flex-col gap-1.5">Description<input name="description" defaultValue={initial?.description} /></label>
      <SubmitButton>{submitLabel}</SubmitButton>
      <div className="w-full"><FormError state={state} /></div>
    </form>
  );
}

export function SecretForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">Clé<input name="key" placeholder="DATABASE_URL" required pattern="[A-Z_][A-Z0-9_]*" className="font-mono" /></label>
      <label className="flex flex-col gap-1.5">Valeur<textarea name="value" rows={2} required autoComplete="off" spellCheck={false} className="font-mono" /></label>
      <p className="text-[13px] text-muted">Une clé existante est remplacée.</p>
      <FormError state={state} />
      <div><SubmitButton>Enregistrer le secret</SubmitButton></div>
    </form>
  );
}

export function ImportForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <textarea name="dotenv" rows={6} placeholder={"DATABASE_URL=postgres://…\nAUTRE=valeur"} spellCheck={false} className="font-mono" />
      <FormError state={state} />
      <div><SubmitButton variant="secondary">Importer</SubmitButton></div>
    </form>
  );
}

export function DeleteForm({ action, label, confirmText }: { action: (state: FormState) => Promise<FormState>; label: string; confirmText: string }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-fg"><input type="checkbox" required /> {confirmText}</label>
      <FormError state={state} />
      <div><SubmitButton variant="danger">{label}</SubmitButton></div>
    </form>
  );
}
