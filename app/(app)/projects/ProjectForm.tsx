"use client";

import cronstrue from "cronstrue/i18n";
import { useActionState, useState, useTransition } from "react";
import { FormError, ReauthLink } from "@/app/components/FormError";
import { SubmitButton } from "@/app/components/SubmitButton";
import type { FormState } from "@/app/login/actions";
import { DB_KINDS, type DbKind } from "@/lib/dumps";
import type { Project } from "@/lib/repo/projects";

type Props = {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  project?: Project;
  // URL enregistrée sans identifiants (dbUrlLabel) ; la valeur complète n'est jamais envoyée avec la page.
  savedUrlLabel?: string | null;
  revealUrl?: () => Promise<{ value: string } | { reauth: true }>;
  submitLabel: string;
};

function describe(expr: string): string {
  try {
    return cronstrue.toString(expr, { locale: "fr", use24HourTimeFormat: true });
  } catch {
    return "Expression invalide";
  }
}

// Afficher l'URL complète demande un code 2FA récent, comme la modifier.
function SavedUrl({ label, reveal }: { label: string; reveal?: Props["revealUrl"] }) {
  const [value, setValue] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [pending, startTransition] = useTransition();
  const toggle = () =>
    startTransition(async () => {
      if (value !== null || !reveal) return setValue(null);
      const r = await reveal();
      if ("reauth" in r) setReauth(true);
      else setValue(r.value);
    });
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-muted">Enregistrée :</span>
      <span className="mono break-all text-fg" data-testid="db-url">{value ?? label}</span>
      {reveal && (
        <button type="button" onClick={toggle} disabled={pending} className="btn btn-ghost">
          {value === null ? "Afficher" : "Masquer"}
        </button>
      )}
      {reauth && <span className="text-warn">Code 2FA requis : <ReauthLink /></span>}
    </div>
  );
}

export function ProjectForm({ action, project, savedUrlLabel, revealUrl, submitLabel }: Props) {
  const [state, formAction] = useActionState(action, {});
  const [kind, setKind] = useState<DbKind>(project?.db_kind ?? "postgres");
  const [cron, setCron] = useState(project?.cron ?? "0 3 * * *");

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">Nom<input name="name" defaultValue={project?.name} required /></label>
        <label className="flex flex-col gap-1.5">
          Type de base
          <select name="db_kind" value={kind} onChange={(e) => setKind(e.target.value as DbKind)}>
            {(Object.keys(DB_KINDS) as DbKind[]).map((k) => <option key={k} value={k}>{DB_KINDS[k].label}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label className="flex flex-col gap-1.5">
            {savedUrlLabel ? "Nouvelle URL de connexion (vide : inchangée)" : "URL de connexion"}
            <input
              name="db_url"
              required={!savedUrlLabel}
              placeholder={DB_KINDS[kind].placeholder}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </label>
          {savedUrlLabel && <SavedUrl label={savedUrlLabel} reveal={revealUrl} />}
          <span className="text-[13px] text-muted">
            Enregistrée chiffrée. Le dump tourne dans une sandbox qui ne peut joindre que l&apos;hôte et le port de cette URL.
            Un compte en lecture seule suffit.
          </span>
        </div>
        <label className="flex flex-col gap-1.5">
          Planification (cron, heure de Paris)
          <input name="cron" value={cron} onChange={(e) => setCron(e.target.value)} required className="font-mono" />
          <span className="text-[13px] text-muted">{describe(cron)}</span>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">Rétention (backups)<input name="retention_count" type="number" min={1} max={1000} defaultValue={project?.retention_count ?? 14} required /></label>
          <label className="flex flex-col gap-1.5">Timeout (min)<input name="timeout_minutes" type="number" min={1} max={1440} defaultValue={project?.timeout_minutes ?? 60} required /></label>
        </div>
        <label className="flex items-center gap-2 text-fg"><input type="checkbox" name="nas_copy" defaultChecked={project?.nas_copy ?? true} /> Copier sur le NAS</label>
        <label className="flex items-center gap-2 text-fg"><input type="checkbox" name="enabled" defaultChecked={project?.enabled ?? true} /> Planification active</label>
      </div>

      <FormError state={state} />
      <div><SubmitButton>{submitLabel}</SubmitButton></div>
    </form>
  );
}
