import { Cron } from "croner";
import { getProject, listProjects, type Project } from "@/lib/repo/projects";
import { startProjectRun, type RunDeps } from "@/lib/runner/run-project";

type SchedulerState = { jobs: Map<number, Cron>; deps: RunDeps | null };
const g = globalThis as unknown as { __bmScheduler?: SchedulerState };
const state = (g.__bmScheduler ??= { jobs: new Map(), deps: null });

function unschedule(projectId: number): void {
  state.jobs.get(projectId)?.stop();
  state.jobs.delete(projectId);
}

function schedule(project: Project): void {
  unschedule(project.id);
  const deps = state.deps;
  if (!deps || !project.enabled) return;
  const job = new Cron(
    project.cron,
    {
      timezone: deps.cfg.tz,
      catch: (e) => console.error(`[scheduler] projet ${project.slug} :`, e),
    },
    () => {
      startProjectRun(project.id, "schedule", deps)?.done.catch((e) =>
        console.error(`[scheduler] run ${project.slug} :`, e),
      );
    },
  );
  state.jobs.set(project.id, job);
}

export function startScheduler(deps: RunDeps): void {
  stopScheduler();
  state.deps = deps;
  for (const project of listProjects(deps.db)) {
    try {
      schedule(project);
    } catch (e) {
      console.error(`[scheduler] projet ${project.slug} non planifié :`, e);
    }
  }
}

export function refreshProjectSchedule(projectId: number): void {
  if (!state.deps) return;
  const project = getProject(state.deps.db, projectId);
  if (project) schedule(project);
  else unschedule(projectId);
}

export function scheduledProjectIds(): number[] {
  return [...state.jobs.keys()];
}

export function stopScheduler(): void {
  for (const id of [...state.jobs.keys()]) unschedule(id);
}

export function getRunDeps(): RunDeps {
  if (!state.deps) throw new Error("Planificateur non démarré");
  return state.deps;
}
