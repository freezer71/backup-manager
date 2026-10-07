import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "@/lib/config";
import type { Run } from "@/lib/repo/runs";

export const NAS_MARKER = ".backup-manager-nas";

// Dossier `slug` directement sous `base` ; null si le slug sortirait de `base` (ou désigne `base` lui-même).
export function safeChildDir(base: string, slug: string): string | null {
  const root = path.resolve(base);
  const dir = path.resolve(root, slug);
  return dir !== root && dir.startsWith(root + path.sep) ? dir : null;
}

export function backupDirName(run: Pick<Run, "id" | "stamp">): string {
  return `${run.stamp}_${run.id}`;
}

export function localBackupDir(cfg: AppConfig, slug: string, run: Pick<Run, "id" | "stamp">): string {
  return path.join(cfg.dataDir, "backups", slug, backupDirName(run));
}

export function nasBackupDir(cfg: AppConfig, slug: string, run: Pick<Run, "id" | "stamp">): string {
  return path.join(cfg.nasDir, slug, backupDirName(run));
}

export async function dirStats(dir: string): Promise<{ files: string[]; size: number }> {
  const files: string[] = [];
  let size = 0;
  const walk = async (current: string) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        files.push(path.relative(dir, full));
        size += (await fs.stat(full)).size;
      }
    }
  };
  await walk(dir);
  return { files: files.sort(), size };
}

export async function moveOutputs(src: string, dest: string): Promise<{ files: string[]; size: number }> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(src, dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await fs.cp(src, dest, { recursive: true });
    await fs.rm(src, { recursive: true, force: true });
  }
  return dirStats(dest);
}

// Un bind mount d'un partage non monté est un dossier vide : le fichier témoin prouve que c'est bien le NAS.
export async function isNasReady(nasDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(nasDir, NAS_MARKER));
    await fs.access(nasDir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function copyToNas(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(src, dest, { recursive: true, errorOnExist: true, force: false });
  const [a, b] = await Promise.all([dirStats(src), dirStats(dest)]);
  if (a.size !== b.size || a.files.length !== b.files.length) {
    throw new Error(`Copie NAS incomplète : ${b.size} octets copiés sur ${a.size}`);
  }
}
