import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, parseTrustedProxies } from "@/lib/auth/client-ip";

const none = parseTrustedProxies(undefined);
const tunnel = parseTrustedProxies("10.0.1.0/24");

describe("clientIpFromHeaders", () => {
  it("sans proxy de confiance, prend la dernière valeur (ajoutée par Traefik)", () => {
    expect(clientIpFromHeaders("6.6.6.6, 192.168.0.46", null, none)).toBe("192.168.0.46");
  });

  it("via cloudflared, saute le proxy de confiance et garde l'IP du visiteur", () => {
    expect(clientIpFromHeaders("82.65.137.215, 10.0.1.21", "10.0.1.21", tunnel)).toBe("82.65.137.215");
  });

  it("ignore un X-Forwarded-For forgé par le client", () => {
    expect(clientIpFromHeaders("6.6.6.6,2a01:e0a:104a:5360::1, 10.0.1.21", "10.0.1.21", tunnel)).toBe("2a01:e0a:104a:5360::1");
  });

  it("en LAN direct, Traefik a remplacé l'en-tête : l'IP LAN est gardée", () => {
    expect(clientIpFromHeaders("192.168.0.46", null, tunnel)).toBe("192.168.0.46");
  });

  it("si tout vient de proxys de confiance, garde le plus éloigné", () => {
    expect(clientIpFromHeaders("10.0.1.5, 10.0.1.21", null, tunnel)).toBe("10.0.1.5");
  });

  it("sans X-Forwarded-For, se replie sur X-Real-Ip puis sur « local »", () => {
    expect(clientIpFromHeaders(null, "192.168.0.46", tunnel)).toBe("192.168.0.46");
    expect(clientIpFromHeaders(null, null, tunnel)).toBe("local");
  });
});

describe("parseTrustedProxies", () => {
  it("accepte plusieurs plages IPv4 et IPv6", () => {
    const list = parseTrustedProxies(" 10.0.1.0/24, fd00::/8 ");
    expect(list.check("10.0.1.21", "ipv4")).toBe(true);
    expect(list.check("fd00::1", "ipv6")).toBe(true);
    expect(list.check("82.65.137.215", "ipv4")).toBe(false);
  });

  it("refuse une plage mal formée plutôt que de faire confiance à n'importe qui", () => {
    expect(() => parseTrustedProxies("10.0.1.0/99")).toThrow(/TRUSTED_PROXIES/);
    expect(() => parseTrustedProxies("pas-une-ip/24")).toThrow(/TRUSTED_PROXIES/);
  });
});
