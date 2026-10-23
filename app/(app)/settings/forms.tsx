"use client";

import { useActionState } from "react";
import { FormError } from "@/app/components/FormError";
import { SubmitButton } from "@/app/components/SubmitButton";
import type { FormState } from "@/app/login/actions";
import { changePasswordAction, replaceTotpAction, saveWebhookAction, testWebhookAction } from "./actions";

export function PasswordForm() {
  const [state, action] = useActionState(changePasswordAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">Mot de passe actuel<input type="password" name="current_password" autoComplete="current-password" required /></label>
      <label className="flex flex-col gap-1.5">Nouveau mot de passe<input type="password" name="new_password" autoComplete="new-password" minLength={12} required /></label>
      <label className="flex flex-col gap-1.5">Confirmation<input type="password" name="confirm_password" autoComplete="new-password" minLength={12} required /></label>
      <FormError state={state} />
      <div><SubmitButton>Changer (déconnecte toutes les sessions)</SubmitButton></div>
    </form>
  );
}

export function ReplaceTotpForm({ qr, secret }: { qr: string; secret: string }) {
  const [state, action] = useActionState(replaceTotpAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="secret" value={secret} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="QR code de la nouvelle application" className="rounded-md bg-white p-2" width={176} height={176} />
      <p className="text-[13px] break-all text-muted">
        Clé manuelle : <span data-testid="totp-new-secret" className="font-mono text-fg">{secret}</span>
      </p>
      <label className="flex flex-col gap-1.5">Mot de passe actuel<input type="password" name="current_password" autoComplete="current-password" required /></label>
      <label className="flex flex-col gap-1.5">Code de la nouvelle application<input name="code" autoComplete="one-time-code" inputMode="numeric" required /></label>
      <FormError state={state} />
      <div><SubmitButton variant="danger">Remplacer (déconnecte toutes les sessions)</SubmitButton></div>
    </form>
  );
}

export function WebhookForm({ current }: { current: string }) {
  const [state, action] = useActionState(saveWebhookAction, {});
  const [testState, testAction] = useActionState<FormState>(testWebhookAction, {});
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">URL (ntfy, Discord…)<input name="webhook_url" defaultValue={current} placeholder="https://ntfy.sh/mes-backups" /></label>
        <SubmitButton>Enregistrer</SubmitButton>
      </form>
      <FormError state={state} />
      <form action={testAction}><SubmitButton variant="secondary">Envoyer une notification de test</SubmitButton></form>
      <FormError state={testState} />
    </div>
  );
}
