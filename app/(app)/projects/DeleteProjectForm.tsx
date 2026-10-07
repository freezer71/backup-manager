"use client";

import { useActionState } from "react";
import { FormError } from "@/app/components/FormError";
import { SubmitButton } from "@/app/components/SubmitButton";
import type { FormState } from "@/app/login/actions";

export function DeleteProjectForm({ action }: { action: (state: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-fg"><input type="checkbox" name="delete_files" /> Supprimer aussi les fichiers de backup (local et NAS)</label>
      <label className="flex items-center gap-2 text-fg"><input type="checkbox" name="confirm" required /> Je confirme la suppression du projet et de son historique</label>
      <FormError state={state} />
      <div><SubmitButton variant="danger">Supprimer</SubmitButton></div>
    </form>
  );
}
