"use client";

import { useState, useTransition } from "react";
import { ReauthLink } from "@/app/components/FormError";
import { deleteSecretAction, revealSecretAction } from "../actions";

export function SecretRow({ id, secretKey, updatedAt }: { id: number; secretKey: string; updatedAt: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [pending, startTransition] = useTransition();

  // Afficher, copier et supprimer demandent un code 2FA récent : sinon, lien vers la confirmation.
  const fetchValue = async (): Promise<string | null> => {
    const r = await revealSecretAction(id);
    if ("reauth" in r) {
      setReauth(true);
      return null;
    }
    return r.value;
  };
  const reveal = () => startTransition(async () => setValue(value === null ? await fetchValue() : null));
  const copy = () =>
    startTransition(async () => {
      const v = value ?? (await fetchValue());
      if (v === null) return;
      await navigator.clipboard.writeText(v);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  const remove = () =>
    startTransition(async () => {
      if ((await deleteSecretAction(id)).reauth) setReauth(true);
    });

  return (
    <tr>
      <td className="mono">{secretKey}</td>
      <td className="mono max-w-md truncate text-muted" data-testid={`secret-${secretKey}`}>
        {reauth ? <span className="font-sans text-warn">Code 2FA requis : <ReauthLink /></span> : (value ?? "••••••••")}
      </td>
      <td className="whitespace-nowrap text-muted">{new Date(updatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
      <td>
        <div className="flex justify-end gap-1">
          <button type="button" disabled={pending} onClick={reveal} className="btn btn-ghost">{value === null ? "Afficher" : "Masquer"}</button>
          <button type="button" disabled={pending} onClick={copy} className="btn btn-ghost">{copied ? "Copié" : "Copier"}</button>
          <button type="button" disabled={pending} onClick={remove} className="btn btn-ghost hover:text-bad">Supprimer</button>
        </div>
      </td>
    </tr>
  );
}
