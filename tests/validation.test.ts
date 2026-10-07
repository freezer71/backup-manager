import { describe, expect, it } from "vitest";
import { assertSecretKey, parseDotenv, slugify, ValidationError } from "@/lib/validation";

describe("assertSecretKey", () => {
  it("accepte les clés en majuscules", () => {
    expect(() => assertSecretKey("DATABASE_URL")).not.toThrow();
    expect(() => assertSecretKey("_X1")).not.toThrow();
  });
  it("refuse minuscules, tirets, chiffre initial et clés réservées", () => {
    for (const k of ["database_url", "DB-URL", "1KEY", "", "PATH", "OUTPUT_DIR", "TIMESTAMP"]) {
      expect(() => assertSecretKey(k)).toThrow(ValidationError);
    }
  });
});

describe("parseDotenv", () => {
  it("lit commentaires, export, guillemets et valeurs avec =", () => {
    const text = '# commentaire\n\nexport A=1\nB="deux mots"\nC=\'x\'\nURL=postgres://u:p@h/db?a=b\r\n';
    expect(parseDotenv(text)).toEqual([
      ["A", "1"],
      ["B", "deux mots"],
      ["C", "x"],
      ["URL", "postgres://u:p@h/db?a=b"],
    ]);
  });
  it("une ligne invalide donne son numéro sans recopier la valeur", () => {
    try {
      parseDotenv("A=1\nceci-est-un-motdepasse-secret");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as Error).message).toContain("2");
      expect((e as Error).message).not.toContain("motdepasse");
    }
  });
});

describe("slugify", () => {
  it("normalise accents et espaces", () => {
    expect(slugify("Pilote Prod (Supabase)")).toBe("pilote-prod-supabase");
    expect(slugify("Éléphant")).toBe("elephant");
  });
  it("refuse un nom sans lettre ni chiffre", () => {
    expect(() => slugify("!!!")).toThrow(ValidationError);
  });
});
