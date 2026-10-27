export class ValidationError extends Error {}

export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  if (!slug) throw new ValidationError("Le nom doit contenir au moins une lettre ou un chiffre");
  return slug;
}

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "SQLITE_CONSTRAINT_UNIQUE";
}

// Convertit une erreur de validation en état de formulaire ; relance toute autre erreur.
export function toFormError(e: unknown): { error: string } {
  if (e instanceof ValidationError) return { error: e.message };
  throw e;
}
