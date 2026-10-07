# Backup Manager

Application web (mono-utilisateur) qui planifie des scripts de backup, stocke leurs secrets dans
une base SQLite chiffrée (SQLCipher) et copie les backups sur le NAS.

## Développement

```bash
npm install
# créer .env.local avec les variables ci-dessous
npm run dev
```

Variables : `DB_ENCRYPTION_KEY` (≥ 32 caractères), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥ 12, premier
démarrage uniquement), `APP_URL`, `DATA_DIR` (défaut `/data`), `NAS_DIR` (défaut `/mnt/backups-nas`),
`TZ` (défaut `Europe/Paris`).

Sur un poste de développement, définissez aussi `DATA_DIR` et `NAS_DIR` dans `.env.local` (par
exemple `./.data/app` et `./.data/nas`, ignorés par git) : les valeurs par défaut (`/data`, `/mnt/backups-nas`) ne
sont pas inscriptibles.

Tests : `npm test` (unitaires), `npm run test:int` (Docker requis), `npm run test:e2e` (Playwright).

## Contrat d'un script

- Exécuté par `bash -euo pipefail` dans un dossier temporaire vide.
- L'environnement transmis est limité aux secrets de l'environnement choisi, `OUTPUT_DIR`,
  `PROJECT_NAME`, `TIMESTAMP` (`YYYY-MM-DD_HH-MM-SS`), `PATH`, `HOME`, `TZ`, `LANG`.
- **Ce n'est pas une isolation.** Le script tourne avec le même utilisateur que l'application et
  pourrait lire la clé maître (`DB_ENCRYPTION_KEY`) via `/proc`. Ne lancez donc que des scripts de
  confiance (les vôtres).
- Succès = code de sortie 0 **et** au moins un fichier dans `$OUTPUT_DIR`.
- Les valeurs des secrets sont masquées (`••••`) dans les logs.

## Déploiement (Dokploy)

### 0. Points de sécurité à connaître avant de déployer

- **Joignable uniquement via Traefik.** Ne publiez aucun port du conteneur (le compose utilise
  `expose`, jamais `ports`). L'IP du client est lue dans `X-Forwarded-For` (dernière valeur) : si
  le port était joignable autrement, n'importe quel conteneur du réseau `dokploy-network` pourrait
  se faire passer pour n'importe quelle IP.
- **Premier démarrage.** Choisissez un `ADMIN_PASSWORD` long et unique, connectez-vous et activez
  la 2FA **immédiatement** après le premier déploiement : tant qu'elle n'est pas activée,
  quiconque connaît le mot de passe peut lier son propre authentificateur. Retirez ensuite
  `ADMIN_PASSWORD` des variables Dokploy.
- **HTTPS obligatoire.** Les cookies de session sont préfixés `__Host-` : l'application doit être
  servie en HTTPS (domaine Dokploy avec Let's Encrypt), sinon la connexion ne fonctionne pas.
- **Appareil de confiance.** Après une connexion complète, le navigateur est mémorisé 90 jours ; il
  n'est alors plus ralenti par les limites globales de connexion. Changer le mot de passe ou
  réinitialiser la 2FA révoque tous les appareils.
- **Clé de chiffrement.** Sans `DB_ENCRYPTION_KEY`, la base est irrécupérable : conservez-la dans
  un gestionnaire de mots de passe.

### 1. Partage NAS en écriture

1. Sur TrueNAS : créer un dataset et un partage SMB `backups`, avec un utilisateur dédié en
   lecture/écriture.
2. Sur le serveur :

   ```bash
   sudo mkdir -p /mnt/backups-nas
   sudo install -m 600 /dev/null /etc/backup-manager-nas.cred
   sudo tee /etc/backup-manager-nas.cred > /dev/null <<'EOT'
   username=<utilisateur-truenas>
   password=<mot-de-passe>
   EOT
   echo '//truenas/backups /mnt/backups-nas cifs rw,credentials=/etc/backup-manager-nas.cred,uid=1001,gid=1001,file_mode=0660,dir_mode=0770,iocharset=utf8,vers=3.0,_netdev,nofail 0 0' | sudo tee -a /etc/fstab
   sudo systemctl daemon-reload && sudo mount /mnt/backups-nas
   sudo -u '#1001' touch /mnt/backups-nas/.backup-manager-nas || sudo touch /mnt/backups-nas/.backup-manager-nas
   ```

   `uid=1001` correspond à l'utilisateur `app` du conteneur. Le fichier `.backup-manager-nas`
   prouve à l'application que le partage est bien monté : sans lui, aucune copie n'est faite et
   chaque backup signale « copie NAS en échec ».

   Si le partage est monté **après** le démarrage du conteneur (montage tardif au boot, remontage
   après une coupure), redémarrez le conteneur : sinon il continue de voir le dossier vide de
   l'hôte, et chaque copie NAS échoue (avec notification).

### 2. DNS

Créer un enregistrement DNS (`A` et/ou `AAAA`) pour le domaine choisi (ici `backups.example.com`) vers l'IP du serveur. Avec Cloudflare, le laisser en **DNS only** (nuage gris) : derrière le proxy Cloudflare, l'application verrait les IP de Cloudflare au lieu de celles des clients (limitation des tentatives faussée), et le challenge HTTP de Let's Encrypt passerait par Cloudflare.

### 3. Dokploy

1. Nouveau projet → « Compose » → dépôt git de ce projet, fichier `docker-compose.yml`.
2. Variables d'environnement : générer la clé avec `openssl rand -base64 48` et la **conserver
   aussi dans votre gestionnaire de mots de passe**.

   ```
   DB_ENCRYPTION_KEY=<clé>
   ADMIN_EMAIL=<email>
   ADMIN_PASSWORD=<mot de passe long et unique, ≥ 12 caractères>
   APP_URL=https://backups.example.com
   ```

3. Onglet « Domains » : `backups.example.com`, port 3000, HTTPS, Let's Encrypt (Dokploy ajoute
   lui-même les labels Traefik ; aucun port n'est publié sur l'hôte).
4. Déployer, ouvrir `https://backups.example.com`, se connecter et activer la double
   authentification sans attendre. Retirer `ADMIN_PASSWORD` des variables.

### 4. Vérifier l'IP vue par l'application

La limitation des tentatives de connexion repose sur l'IP du client. Après le déploiement :

1. Se connecter depuis deux réseaux différents (par exemple le Wi-Fi, puis la 4G du téléphone).
2. Ouvrir Paramètres → Journal d'audit.
3. Vérifier que la colonne IP (la dernière) des deux connexions montre **deux adresses publiques
   différentes**.

Si elle montre la même adresse privée (`172.x.x.x` ou `10.x.x.x`), Traefik ne voit pas l'IP
réelle du client : la limitation des tentatives serait alors partagée par tout le monde (un
attaquant bloquerait votre propre connexion). Configurez Traefik avant d'utiliser
l'application : ports publiés en mode `host`, ou `forwardedHeaders.trustedIPs` sur le point
d'entrée si un autre proxy est placé devant.

## Restaurer un dump

PostgreSQL (`.dump`) :

```bash
pg_restore -d "$DATABASE_URL" -v <fichier>.dump
```

MongoDB (`.archive.gz`) :

```bash
mongorestore --uri="$MONGO_URI" --archive=<fichier> --gzip
```
