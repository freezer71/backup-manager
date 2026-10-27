export type TemplateId = "postgres" | "mongodb" | "empty";

// networkSecret : secret dont l'URL est la seule destination réseau du script (vide : aucun réseau).
export const TEMPLATES: Record<TemplateId, { label: string; networkSecret: string; script: string }> = {
  postgres: {
    label: "PostgreSQL (pg_dump)",
    networkSecret: "DATABASE_URL",
    script: `# Secrets attendus : DATABASE_URL
OUT="$OUTPUT_DIR/\${PROJECT_NAME}-backup_\${TIMESTAMP}.dump"

pg_dump "$DATABASE_URL" -F c -f "$OUT"

# Vérifie que le dump est lisible (échoue sinon)
pg_restore -l "$OUT" > /dev/null

echo "OK: $(du -h "$OUT" | cut -f1), $(pg_restore -l "$OUT" | grep -c 'TABLE DATA') tables"
`,
  },
  mongodb: {
    label: "MongoDB (mongodump)",
    networkSecret: "MONGO_URI",
    script: `# Secrets attendus : MONGO_URI
OUT="$OUTPUT_DIR/\${PROJECT_NAME}-backup_\${TIMESTAMP}.archive.gz"

mongodump --uri="$MONGO_URI" --archive="$OUT" --gzip

echo "OK: $(du -h "$OUT" | cut -f1)"
`,
  },
  empty: {
    label: "Script vide",
    networkSecret: "",
    script: `# Écrivez vos fichiers dans "$OUTPUT_DIR".
# Variables disponibles : les secrets de l'environnement, OUTPUT_DIR, PROJECT_NAME, TIMESTAMP.
`,
  },
};
