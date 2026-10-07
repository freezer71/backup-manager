"use client";

import { useActionState } from "react";
import { FormError } from "@/app/components/FormError";
import { SubmitButton } from "@/app/components/SubmitButton";
import type { FormState } from "./actions";

type Field = { name: string; label: string; type: string; autoComplete: string; inputMode?: "numeric" };

export function LoginForm({
  action,
  fields,
  submitLabel,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  fields: Field[];
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-4 [&_button]:w-full [&_button]:h-9">
      {fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-1.5">
          {f.label}
          <input
            name={f.name}
            type={f.type}
            autoComplete={f.autoComplete}
            inputMode={f.inputMode}
            required
            className={f.inputMode === "numeric" ? "font-mono tracking-[0.3em]" : undefined}
          />
        </label>
      ))}
      <FormError state={state} />
      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
