"use client";

import cronstrue from "cronstrue/i18n";
import { useActionState, useState } from "react";
import { FormError } from "@/app/components/FormError";
import { SubmitButton } from "@/app/components/SubmitButton";
import type { FormState } from "@/app/login/actions";
import type { Project } from "@/lib/repo/projects";
import { TEMPLATES, type TemplateId } from "@/lib/templates";
import { ScriptEditor } from "./ScriptEditor";

type Props = {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  environments: Array<{ id: number; name: string }>;
  project?: Project;
  submitLabel: string;
};

function describe(expr: string): string {
  try {
    return cronstrue.toString(expr, { locale: "fr", use24HourTimeFormat: true });
  } catch {
    return "Expression invalide";
  }
}

export function ProjectForm({ action, environments, project, submitLabel }: Props) {
  const [state, formAction] = useActionState(action, {});
  const [script, setScript] = useState(project?.script ?? TEMPLATES.postgres.script);
  const [cron, setCron] = useState(project?.cron ?? "0 3 * * *");

  const loadFile = async (file: File | undefined) => {
    if (file) setScript(await file.text());
  };

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">Nom<input name="name" defaultValue={project?.name} required /></label>
        <label className="flex flex-col gap-1.5">
          Environnement de secrets
          <select name="environment_id" defaultValue={project?.environment_id ?? ""}>
            <option value="">Aucun</option>
            {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
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

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium text-fg">Script</span>
          <select aria-label="Modèle" defaultValue="" onChange={(e) => { if (e.target.value) setScript(TEMPLATES[e.target.value as TemplateId].script); e.target.value = ""; }}>
            <option value="">Charger un modèle…</option>
            {(Object.keys(TEMPLATES) as TemplateId[]).map((id) => <option key={id} value={id}>{TEMPLATES[id].label}</option>)}
          </select>
          <label className="btn btn-secondary cursor-pointer">
            Envoyer un fichier .sh
            <input type="file" accept=".sh,text/x-shellscript,text/plain" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />
          </label>
        </div>
        <ScriptEditor value={script} onChange={setScript} />
        <input type="hidden" name="script" value={script} />
        <p className="text-[13px] text-muted">
          Exécuté avec <code>bash -euo pipefail</code>. Écrivez vos fichiers dans <code>$OUTPUT_DIR</code> ; les secrets de l&apos;environnement sont des variables d&apos;environnement, avec <code>$PROJECT_NAME</code> et <code>$TIMESTAMP</code>.
        </p>
      </div>

      <FormError state={state} />
      <div><SubmitButton>{submitLabel}</SubmitButton></div>
    </form>
  );
}
