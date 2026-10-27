import { execFileSync } from "node:child_process";

// Une vraie base PostgreSQL pour le parcours complet : un projet ne fait plus que des dumps.
// L'URL passe aux tests par l'environnement (hérité par les workers).
export const PG_CONTAINER = "bm-e2e-pg";
const PASSWORD = "e2e-pg-mot-de-passe";

export default async function globalSetup() {
  execFileSync("docker", ["rm", "-f", PG_CONTAINER], { stdio: "ignore" });
  execFileSync("docker", ["run", "-d", "--rm", "--name", PG_CONTAINER, "-e", `POSTGRES_PASSWORD=${PASSWORD}`, "-p", "127.0.0.1::5432", "postgres:17"], { stdio: "ignore" });
  const port = execFileSync("docker", ["port", PG_CONTAINER, "5432"]).toString().trim().split("\n")[0].split(":").at(-1);
  for (let i = 0; i < 90; i++) {
    try {
      execFileSync("docker", ["exec", PG_CONTAINER, "psql", "-U", "postgres", "-c", "CREATE TABLE IF NOT EXISTS t (id int); INSERT INTO t VALUES (1);"], { stdio: "ignore" });
      process.env.E2E_PG_URL = `postgresql://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`;
      process.env.E2E_PG_PASSWORD = PASSWORD;
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Postgres (e2e) n'a pas démarré");
}
