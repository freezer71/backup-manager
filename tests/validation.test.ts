import { describe, expect, it } from "vitest";
import { slugify, ValidationError } from "@/lib/validation";

describe("slugify", () => {
  it("normalise accents et espaces", () => {
    expect(slugify("Pilote Prod (Supabase)")).toBe("pilote-prod-supabase");
    expect(slugify("Éléphant")).toBe("elephant");
  });
  it("refuse un nom sans lettre ni chiffre", () => {
    expect(() => slugify("!!!")).toThrow(ValidationError);
  });
});
