// Un projet = une base à sauvegarder. Le dump est toujours l'un de ces scripts, jamais du code saisi par l'utilisateur :
// l'URL est la seule donnée qui varie, transmise dans la variable DATABASE_URL (et seule destination réseau du run).
export type DbKind = "postgres" | "mongodb";

export const DB_URL_VAR = "DATABASE_URL";

export const DB_KINDS: Record<DbKind, { label: string; schemes: string[]; placeholder: string; script: string }> = {
  postgres: {
    label: "PostgreSQL",
    schemes: ["postgres", "postgresql"],
    placeholder: "postgresql://utilisateur:mot-de-passe@hôte:5432/base",
    script: `OUT="$OUTPUT_DIR/\${PROJECT_NAME}-backup_\${TIMESTAMP}.dump"

pg_dump "$DATABASE_URL" -F c -f "$OUT"

# Vérifie que le dump est lisible (échoue sinon)
pg_restore -l "$OUT" > /dev/null

echo "OK: $(du -h "$OUT" | cut -f1), $(pg_restore -l "$OUT" | grep -c 'TABLE DATA') tables"
`,
  },
  mongodb: {
    label: "MongoDB",
    schemes: ["mongodb", "mongodb+srv"],
    placeholder: "mongodb+srv://utilisateur:mot-de-passe@cluster.example.net/base",
    script: `OUT="$OUTPUT_DIR/\${PROJECT_NAME}-backup_\${TIMESTAMP}.archive.gz"

mongodump --uri="$DATABASE_URL" --archive="$OUT" --gzip

# Vérifie que l'archive est complète (échoue sinon)
gzip -t "$OUT"

echo "OK: $(du -h "$OUT" | cut -f1)"
`,
  },
};

export function isDbKind(value: unknown): value is DbKind {
  return typeof value === "string" && Object.hasOwn(DB_KINDS, value);
}
