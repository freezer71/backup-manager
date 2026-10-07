"use client";

import { useState, useTransition } from "react";
import { deleteSecretAction, revealSecretAction } from "../actions";

export function SecretRow({ id, secretKey, updatedAt }: { id: number; secretKey: string; updatedAt: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const reveal = () => startTransition(async () => setValue(value === null ? await revealSecretAction(id) : null));
  const copy = () =>
    startTransition(async () => {
      await navigator.clipboard.writeText(value ?? (await revealSecretAction(id)));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  return (
    <tr>
      <td className="mono">{secretKey}</td>
      <td className="mono max-w-md truncate text-muted" data-testid={`secret-${secretKey}`}>
        {value ?? "••••••••"}
      </td>
      <td className="whitespace-nowrap text-muted">{new Date(updatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
      <td>
        <div className="flex justify-end gap-1">
          <button type="button" disabled={pending} onClick={reveal} className="btn btn-ghost">{value === null ? "Afficher" : "Masquer"}</button>
          <button type="button" disabled={pending} onClick={copy} className="btn btn-ghost">{copied ? "Copié" : "Copier"}</button>
          <button type="button" disabled={pending} onClick={() => startTransition(() => deleteSecretAction(id))} className="btn btn-ghost hover:text-bad">Supprimer</button>
        </div>
      </td>
    </tr>
  );
}
