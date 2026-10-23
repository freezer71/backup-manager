import { BlockList, isIP } from "node:net";

// Proxys placés devant Traefik (ex. cloudflared sur dokploy-network), en CIDR séparés par des virgules.
export function parseTrustedProxies(value: string | undefined): BlockList {
  const list = new BlockList();
  for (const cidr of (value ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [address, prefix] = cidr.split("/");
    const family = isIP(address);
    const bits = Number(prefix);
    if (!family || !Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128)) {
      throw new Error(`TRUSTED_PROXIES : plage invalide « ${cidr} » (attendu : 10.0.1.0/24)`);
    }
    list.addSubnet(address, bits, family === 4 ? "ipv4" : "ipv6");
  }
  return list;
}

// Lit X-Forwarded-For depuis la droite : chaque valeur ajoutée par un proxy de confiance est sautée,
// la première qui n'en vient pas est le client. Le début de la liste, fourni par le client, n'est jamais cru.
export function clientIpFromHeaders(forwarded: string | null, realIp: string | null, trusted: BlockList): string {
  const hops = (forwarded ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (hops.length === 0) return realIp ?? "local";
  for (let i = hops.length - 1; i > 0; i--) {
    const family = isIP(hops[i]);
    if (!family || !trusted.check(hops[i], family === 4 ? "ipv4" : "ipv6")) return hops[i];
  }
  return hops[0];
}
