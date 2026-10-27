import { execFileSync } from "node:child_process";
import { PG_CONTAINER } from "./global-setup";

export default function globalTeardown() {
  execFileSync("docker", ["rm", "-f", PG_CONTAINER], { stdio: "ignore" });
}
