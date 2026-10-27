// Un projet = une base à sauvegarder. Le dump est toujours l'un de ces scripts, jamais du code saisi par l'utilisateur :
// l'URL est la seule donnée qui varie, transmise dans la variable DATABASE_URL (et seule destination réseau du run).
export type DbKind = "postgres" | "mongodb" | "mysql";

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
  // mariadb-dump ne lit pas d'URL : le script la découpe (un seul hôte, vérifié par lib/db-url.ts). Le mot de passe
  // passe par MYSQL_PWD, jamais par la ligne de commande (visible dans ps).
  mysql: {
    label: "MySQL / MariaDB",
    schemes: ["mysql", "mariadb"],
    placeholder: "mysql://utilisateur:mot-de-passe@hôte:3306/base?ssl-mode=REQUIRED",
    script: `OUT="$OUTPUT_DIR/\${PROJECT_NAME}-backup_\${TIMESTAMP}.sql.gz"

decode() { local s="\${1//\\\\/\\\\\\\\}"; printf '%b' "\${s//%/\\\\x}"; }

rest="\${DATABASE_URL#*://}"
authority="\${rest%%[/?#]*}"
rest="\${rest#"$authority"}"
user=""
export MYSQL_PWD=""
if [[ "$authority" == *@* ]]; then
  userinfo="\${authority%@*}"
  authority="\${authority##*@}"
  user="$(decode "\${userinfo%%:*}")"
  [[ "$userinfo" == *:* ]] && MYSQL_PWD="$(decode "\${userinfo#*:}")"
fi
host="\${authority%:*}"
port=3306
[[ "$authority" == *:* ]] && port="\${authority##*:}"
base="\${rest#/}"
base="$(decode "\${base%%[?#]*}")"
query=""
[[ "$rest" == *\\?* ]] && query="\${rest#*\\?}"
query="\${query%%#*}"

opts=(--protocol=TCP --host="$host" --port="$port" --single-transaction --quick --routines --triggers --hex-blob --no-tablespaces --default-character-set=utf8mb4)
[[ -n "$user" ]] && opts+=(--user="$user")
# Valeur vérifiée par lib/db-url.ts. Le client MariaDB ne sait pas vérifier le certificat sans le nom d'hôte :
# VERIFY_CA vérifie les deux, comme VERIFY_IDENTITY.
shopt -s nocasematch
case "&$query&" in
  *"&ssl-mode=verify_identity&"* | *"&ssl-mode=verify_ca&"*) opts+=(--ssl --ssl-verify-server-cert --ssl-ca=/etc/ssl/certs/ca-certificates.crt) ;;
  *"&ssl-mode=required&"*) opts+=(--ssl) ;;
  *"&ssl-mode=disabled&"*) opts+=(--skip-ssl) ;;
  *"&ssl-mode="*) echo "ssl-mode non pris en charge" >&2; exit 1 ;;
esac
shopt -u nocasematch
# Un nom commençant par « - » serait lu comme une option de mariadb-dump.
if [[ "$base" == -* ]]; then echo "nom de base invalide" >&2; exit 1; fi
if [[ -n "$base" ]]; then opts+=(--databases "$base"); else opts+=(--all-databases); fi

mariadb-dump "\${opts[@]}" | gzip > "$OUT"

# Vérifie que l'archive est complète et que le dump est allé jusqu'au bout (échoue sinon)
gzip -t "$OUT"
gzip -dc "$OUT" | tail -n 1 | grep -q "Dump completed"

echo "OK: $(du -h "$OUT" | cut -f1), $(gzip -dc "$OUT" | grep -c '^CREATE TABLE') tables"
`,
  },
};

export function isDbKind(value: unknown): value is DbKind {
  return typeof value === "string" && Object.hasOwn(DB_KINDS, value);
}
