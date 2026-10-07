import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 3310;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command:
      "mkdir -p .e2e-data .e2e-nas && npm run build && cp -r .next/static .next/standalone/.next/static && (cp -r public .next/standalone/public 2>/dev/null || true) && node .next/standalone/server.js",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      DB_ENCRYPTION_KEY: "e2e-key-0123456789abcdef0123456789abcdef",
      DATA_DIR: path.resolve(".e2e-data"),
      NAS_DIR: path.resolve(".e2e-nas"),
      ADMIN_EMAIL: "e2e@example.com",
      ADMIN_PASSWORD: "e2e-password-123",
      APP_URL: `http://localhost:${PORT}`,
      TZ: "Europe/Paris",
    },
  },
});
