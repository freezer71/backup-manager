// Client minimal du runner, exécuté DANS le conteneur runner par tests/sandbox.int.test.ts (docker exec).
// Envoie la requête (JSON en argument), attend le résultat, liste les sorties, puis ferme la connexion
// (ce qui fait nettoyer le run). Affiche une ligne JSON : { result, files, error }.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const req = JSON.parse(process.argv[2]);
const sock = net.createConnection(process.env.RUNNER_SOCKET || "/run/bm/runner.sock");
let buffer = "";
const done = (out) => {
  process.stdout.write(JSON.stringify(out) + "\n");
  sock.end();
  setTimeout(() => process.exit(0), 200);
};
sock.setEncoding("utf8");
sock.on("connect", () => sock.write(JSON.stringify(req) + "\n"));
sock.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const m = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    if (m.t === "error") done({ error: m.message });
    if (m.t === "result") {
      const files = fs.readdirSync(m.outDir).map((name) => ({ name, size: fs.statSync(path.join(m.outDir, name)).size }));
      done({ result: m, files });
    }
  }
});
sock.on("error", (e) => done({ error: e.message }));
