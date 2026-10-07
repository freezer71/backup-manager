export class ValidationError extends Error {}

export const SECRET_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
export const RESERVED_KEYS = new Set(["PATH", "HOME", "TZ", "LANG", "OUTPUT_DIR", "PROJECT_NAME", "TIMESTAMP"]);

export function assertSecretKey(key: string): void {
  if (!SECRET_KEY_RE.test(key)) {
    throw new ValidationError(`Clé invalide « ${key} » : majuscules, chiffres et _ uniquement`);
  }
  if (RESERVED_KEYS.has(key)) {
    throw new ValidationError(`« ${key} » est réservée par l'application`);
  }
}

// Le message d'erreur ne contient que le numéro de ligne : la ligne peut contenir un secret.
export function parseDotenv(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) throw new ValidationError(`Ligne ${index + 1} invalide (format attendu : CLÉ=valeur)`);
    let value = m[2];
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    out.push([m[1], value]);
  });
  return out;
}

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
