"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Interroge la route JSON toutes les 2 s tant que le run tourne,
// puis rafraîchit la page une seule fois pour afficher fichiers et statut final.
// Après 3 réponses 401/404 d'affilée (session expirée, run supprimé), on arrête de sonder.
const MAX_AUTH_ERRORS = 3;

export function LiveLog({ runId, initialLog, running }: { runId: number; initialLog: string; running: boolean }) {
  const [log, setLog] = useState(initialLog);
  const [interrupted, setInterrupted] = useState(false);
  const router = useRouter();
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let authErrors = 0;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (stopped) return;
        if (res.status === 401 || res.status === 404) {
          if (++authErrors >= MAX_AUTH_ERRORS) {
            stopped = true;
            clearInterval(timer);
            setInterrupted(true);
          }
          return;
        }
        authErrors = 0;
        if (!res.ok) return;
        const data = (await res.json()) as { status: string; log: string };
        if (stopped) return;
        setLog(data.log);
        if (data.status !== "running") {
          stopped = true;
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // Erreur réseau passagère : on réessaie au prochain tour.
      }
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [runId, running, router]);

  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
  }, [log]);

  return (
    <>
      {interrupted && (
        <p role="alert" className="mb-2 text-[13px] text-warn">
          Suivi interrompu (session expirée ?) — rechargez la page.
        </p>
      )}
      <pre ref={preRef} data-testid="run-log" className="panel mono max-h-[60vh] overflow-auto bg-raised p-4 leading-relaxed text-fg">
        {log || (running ? "En attente de sortie…" : "Aucune sortie.")}
      </pre>
    </>
  );
}
