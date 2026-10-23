import type { NextConfig } from "next";

// Pas de CSP pour les scripts : elle casserait Next sans nonces. frame-ancestors seul protège du clickjacking.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3-multiple-ciphers", "@node-rs/argon2"],
  // Aucune image ne passe par next/image, mais /_next/image répondait sans session : c'est là que tombent
  // les failles d'exécution de code de Next (sharp, AVIF puis SVG, automne 2026). Désactivé, la route ne traite plus rien.
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
