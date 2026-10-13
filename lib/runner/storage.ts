import { constants, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
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

// $OUTPUT_DIR doit rester un vrai dossier : remplacé par un lien, il ferait lister (et télécharger) autre chose.
export async function assertRealDir(dir: string): Promise<void> {
  const st = await fs.lstat(dir);
  if (!st.isDirectory()) throw new Error("$OUTPUT_DIR a été remplacé par un lien ou un fichier : refusé");
}

// Copie les sorties du script (le dossier source peut être en lecture seule : volume du runner).
// Seuls les fichiers et dossiers réels sont copiés, ouverts sans suivre de lien ; le reste est ignoré et listé.
export async function copyOutputs(src: string, dest: string): Promise<{ files: string[]; size: number; skipped: string[] }> {
  await assertRealDir(src);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.mkdir(dest);
  const skipped: string[] = [];
  const walk = async (from: string, to: string) => {
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      const source = path.join(from, entry.name);
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(target);
        await walk(source, target);
      } else if (entry.isFile()) {
        const fh = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
        await pipeline(fh.createReadStream(), createWriteStream(target, { flags: "wx" }));
      } else {
        skipped.push(path.relative(src, source));
      }
    }
  };
  await walk(src, dest);
  return { ...(await dirStats(dest)), skipped: skipped.sort() };
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
