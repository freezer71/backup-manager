import { PHASE_PRODUCTION_BUILD } from "next/constants";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;
  // L'arrêt du processus (process.exit) vit dans lib/bootstrap.ts : ce fichier est aussi compilé pour Edge.
  const { bootstrapOrExit } = await import("./lib/bootstrap");
  await bootstrapOrExit();
}
