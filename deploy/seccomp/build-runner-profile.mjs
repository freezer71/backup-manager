// Génère deploy/seccomp/runner.json à partir du profil seccomp par défaut de Docker (commit épinglé).
// Usage : node deploy/seccomp/build-runner-profile.mjs
//
// Différences avec le profil de Docker, pour que bubblewrap crée une sandbox par run :
// - avec CAP_SYS_ADMIN, seuls mount, umount, umount2, pivot_root et sethostname sont ajoutés
//   (Docker y ajoutait aussi bpf, perf_event_open, setns, syslog… dont la sandbox n'a pas besoin) ;
// - clone et unshare sont autorisés sans CLONE_NEWUSER, pour tout le monde : aucun processus du runner,
//   script compris, ne peut créer d'espace de noms utilisateur (et y regagner des capacités) ;
// - clone3 renvoie toujours ENOSYS (ses drapeaux ne sont pas filtrables) : la libc se rabat sur clone.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT = "6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef";
const URL = `https://raw.githubusercontent.com/moby/profiles/${COMMIT}/seccomp/default.json`;
const CLONE_NEWUSER = 0x10000000;
const ENOSYS = 38;

const res = await fetch(URL);
if (!res.ok) throw new Error(`${URL} : HTTP ${res.status}`);
const profile = await res.json();

const removed = new Set(["clone", "clone3", "unshare"]);
const syscalls = [];
for (const rule of profile.syscalls) {
  if (rule.names.some((n) => removed.has(n))) {
    // Règles de Docker pour clone/clone3/unshare : remplacées plus bas.
    const kept = rule.names.filter((n) => !removed.has(n));
    if (kept.length === 0) continue;
    if (JSON.stringify(rule.includes) === JSON.stringify({ caps: ["CAP_SYS_ADMIN"] })) {
      syscalls.push({ ...rule, names: ["mount", "umount", "umount2", "pivot_root", "sethostname"] });
    } else {
      syscalls.push({ ...rule, names: kept });
    }
    continue;
  }
  syscalls.push(rule);
}

const noNewUser = (index) => [{ index, value: CLONE_NEWUSER, valueTwo: 0, op: "SCMP_CMP_MASKED_EQ" }];
syscalls.push(
  { names: ["clone"], action: "SCMP_ACT_ALLOW", args: noNewUser(0), excludes: { arches: ["s390", "s390x"] } },
  { names: ["clone"], action: "SCMP_ACT_ALLOW", args: noNewUser(1), includes: { arches: ["s390", "s390x"] } },
  { names: ["unshare"], action: "SCMP_ACT_ALLOW", args: noNewUser(0) },
  { names: ["clone3"], action: "SCMP_ACT_ERRNO", errnoRet: ENOSYS },
);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "runner.json");
fs.writeFileSync(out, JSON.stringify({ ...profile, syscalls }, null, 2) + "\n");
console.log(`${out} écrit (${syscalls.length} règles, base moby/profiles@${COMMIT.slice(0, 12)})`);
