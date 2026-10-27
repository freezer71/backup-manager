# Backup Manager

Application web (mono-utilisateur) qui sauvegarde des bases PostgreSQL, MongoDB et MySQL / MariaDB à heure fixe,
stocke leurs URL de connexion dans une base SQLite chiffrée (SQLCipher) et copie les backups sur le NAS.

## Développement

```bash
npm install
# créer .env.local avec les variables ci-dessous
npm run dev
```

Variables : `DB_ENCRYPTION_KEY` (≥ 32 caractères), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥ 12, premier
démarrage uniquement), `APP_URL`, `DATA_DIR` (défaut `/data`), `NAS_DIR` (défaut `/mnt/backups-nas`),
`TZ` (défaut `Europe/Paris`), `NAS_AGE_RECIPIENTS` (obligatoire en production, voir « Chiffrement des copies NAS »),
`TRUSTED_PROXIES` (facultatif, voir « Derrière un tunnel »).

Sur un poste de développement, définissez aussi `DATA_DIR` et `NAS_DIR` dans `.env.local` (par
exemple `./.data/app` et `./.data/nas`, ignorés par git) : les valeurs par défaut (`/data`, `/mnt/backups-nas`) ne
sont pas inscriptibles.

Tests : `npm test` (unitaires), `npm run test:int` (Docker requis), `npm run test:e2e` (Playwright,
Docker et `pg_dump` requis : une base PostgreSQL de test est lancée dans Docker).

## Un projet = une base

Un projet a un nom, un type de base (PostgreSQL, MongoDB ou MySQL / MariaDB) et une URL de connexion, plus sa
planification, sa rétention et sa copie NAS. Il n'y a pas de script à écrire : l'application lance
toujours le même dump selon le type (`lib/dumps.ts`).

- **PostgreSQL** : `pg_dump -F c`, vérifié avec `pg_restore -l` ; fichier `<projet>-backup_<date>.dump`.
- **MongoDB** : `mongodump --archive --gzip`, vérifié avec `gzip -t` ; fichier `<projet>-backup_<date>.archive.gz`.
- **MySQL / MariaDB** : `mariadb-dump --single-transaction --routines --triggers | gzip`, vérifié avec `gzip -t` et
  la ligne finale `Dump completed` ; fichier `<projet>-backup_<date>.sql.gz`. URL `mysql://` ou `mariadb://`, un seul
  hôte ; sans nom de base, toutes les bases sont sauvegardées. TLS : `?ssl-mode=REQUIRED` (chiffré) ou
  `?ssl-mode=VERIFY_IDENTITY` (certificat et nom d'hôte vérifiés). Le client MariaDB fonctionne aussi avec MySQL 8 et 9.
- L'URL est enregistrée chiffrée. La page du projet n'en montre que l'hôte et la base ; l'afficher en
  entier ou la changer demande un code 2FA récent. Un compte **en lecture seule** sur la base suffit.
- L'URL est masquée (`••••`) dans les journaux, ainsi que son mot de passe et ses formes encodées.

Fonctionnement d'un dump :

- En production, le dump tourne dans le conteneur `runner`, séparé de l'application : il n'a ni
  la base, ni `DB_ENCRYPTION_KEY`, ni le NAS, ni le réseau Dokploy. Chaque run a son propre uid
  (100000 + id du run) : un dump ne lit ni l'environnement ni les fichiers d'un autre run, et ne
  peut pas joindre le socket du runner. À la fin du run, tout ce qui tourne encore sous cet uid est
  tué (y compris un démon sorti du groupe avec `setsid`).
- **Sandbox par run** (bubblewrap, voir « Sandbox des dumps ») : le dump ne voit que ses propres
  processus, n'écrit que dans son dossier de sortie et son dossier temporaire (tout le reste est en
  lecture seule), et n'a **aucun réseau** sauf vers l'hôte et le port de l'URL du projet (pas de DNS).
  Si le serveur de la base, ou un proxy sur le chemin, cherchait à exploiter `pg_dump`, il resterait
  enfermé là.
- Sortie + dossier temporaire sont limités à 50 Gio par run (`RUN_MAX_BYTES` sur le runner) : au-delà,
  le run est arrêté.
- En développement (sans `RUNNER_SOCKET`), le dump tourne dans le processus de l'application
  (`pg_dump` / `mongodump` / `mariadb-dump` du poste), sans aucune isolation. En production, l'application refuse de démarrer sans `RUNNER_SOCKET`
  (sauf `RUNNER_MODE=local`, réservé aux tests e2e).
- Succès = dump terminé sans erreur, vérifié, **et** un fichier produit.

Les projets créés avant cette version (environnement de secrets + script) ont été convertis
automatiquement : chacun a repris l'URL du secret ouvert au réseau (`DATABASE_URL` ou `MONGO_URI`).
Un projet sans URL a été désactivé ; renseignez-la dans sa configuration.

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
  l'application 2FA révoque tous les appareils.
- **Changer d'application 2FA.** Dans Paramètres, la nouvelle application est validée (mot de passe
  + code) avant de remplacer l'ancienne : le compte n'est jamais sans 2FA. Pas de réinitialisation
  qui l'effacerait, sinon le mot de passe seul suffirait à lier un autre authentificateur. La clé
  affichée change à chaque visite et n'est stockée qu'au remplacement : une session volée ne peut
  pas lire à l'avance celle que vous allez scanner.
- **Clé de chiffrement.** Sans `DB_ENCRYPTION_KEY`, la base est irrécupérable : conservez-la dans
  un gestionnaire de mots de passe.
- **Réseau du runner.** Le compose crée le bridge `br-bm-runner`. Sur l'hôte, le pare-feu doit
  n'autoriser depuis ce bridge que l'Internet public : ni LAN, ni autres réseaux Docker, ni l'hôte
  lui-même. Sur le homelab, c'est fait par `/usr/local/sbin/homelab-firewall` (chaînes
  `HOMELAB-RUNNER` dans `DOCKER-USER` et `HOMELAB-RUNNER-IN` dans `INPUT`, interfaces `br-bm+`).
  Le runner utilise 1.1.1.1 et 9.9.9.9 comme DNS, puisque le résolveur de la box est sur le LAN.
- **Conteneurs durcis.** Les deux conteneurs sont en lecture seule (`read_only`), avec
  `no-new-privileges` et des limites de mémoire et de processus. L'application n'a aucune capacité.
  Le runner garde CHOWN, SETUID, SETGID et KILL, plus SYS_ADMIN, NET_ADMIN et NET_BIND_SERVICE pour
  construire la sandbox de chaque run ; en contrepartie, il tourne sous un profil seccomp
  (`deploy/seccomp/runner.json`) et un profil AppArmor (`bm-runner`) sur mesure. Le code appartient
  à root dans les images.
- **Code 2FA récent pour les actions sensibles.** Afficher l'URL de connexion d'un projet, créer,
  modifier ou supprimer un projet, changer le webhook et télécharger un backup demandent un code TOTP
  saisi depuis moins de 10 minutes. Une session volée seule ne lit donc aucune URL de base. Les sessions expirent après 4 h d'inactivité ; Paramètres liste les
  sessions et les appareils de confiance, révocables.
- **Alertes de sécurité.** Le webhook reçoit, en plus des résultats des runs, une alerte pour chaque
  événement sensible (nouvel appareil, URL de connexion affichée ou modifiée, projet créé ou
  supprimé, téléchargement, mot de passe ou 2FA changés). Changer le webhook prévient aussi l'ancien.
  Le webhook doit être en `https://` vers une adresse publique (ni LAN, ni réseau Docker) ; l'URL
  enregistrée n'est plus jamais réaffichée.
- **CSP.** Chaque page porte une Content-Security-Policy avec nonce (`proxy.ts`) : seuls les scripts
  de l'application s'exécutent, et rien ne peut être envoyé vers un autre site.

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

### 0 bis. Sandbox des dumps : profil AppArmor (une fois, avant le premier déploiement)

Le runner démarre sous le profil AppArmor `bm-runner` : s'il n'est pas chargé sur l'hôte, Docker
refuse de lancer le conteneur. Depuis une copie du dépôt sur le serveur :

```bash
sudo install -m 644 deploy/apparmor/bm-runner /etc/apparmor.d/bm-runner
sudo apparmor_parser -r -W /etc/apparmor.d/bm-runner
sudo aa-status | grep bm-runner   # doit afficher bm-runner
```

Le profil est rechargé à chaque démarrage de l'hôte (fichier dans `/etc/apparmor.d`). À refaire
seulement si `deploy/apparmor/bm-runner` change.

Au démarrage, le runner vérifie lui-même la sandbox (lancement d'un run de test) et refuse de
démarrer si elle ne fonctionne pas : le journal du conteneur affiche alors la cause. Un démarrage
réussi affiche « (sandbox par run) ».

Ce que la sandbox ne fait pas : elle partage le noyau de l'hôte (comme tout conteneur). Pour limiter
aussi ce que peut faire la base, utilisez un **compte en lecture seule** dans l'URL du projet : la sandbox empêche d'aller ailleurs, pas de modifier la base autorisée.

### 1 bis. Chiffrement des copies NAS (obligatoire en production)

En production, l'application refuse de démarrer sans `NAS_AGE_RECIPIENTS`.

Avec `NAS_AGE_RECIPIENTS`, chaque fichier copié sur le NAS est chiffré avec [age](https://age-encryption.org)
pour cette clé publique (`<fichier>.age`). Le NAS, ses administrateurs et quiconque vole ses disques ne voient
que du chiffré ; l'application elle-même ne peut pas relire ses copies NAS. La copie locale (`/data`,
téléchargeable depuis l'interface) reste en clair.

1. Sur **votre** poste, pas sur le serveur :

   ```bash
   age-keygen -o ~/.config/backup-manager/age-identity.txt   # clé privée : à garder aussi dans le gestionnaire de mots de passe
   age-keygen -y ~/.config/backup-manager/age-identity.txt   # clé publique : age1…
   ```

2. Dans Dokploy, ajouter `NAS_AGE_RECIPIENTS=age1…` (plusieurs clés : séparées par des virgules), puis
   redéployer. Une valeur mal formée empêche l'application de démarrer plutôt que de copier en clair.
3. Chaque run concerné affiche « Copie NAS chiffrée (age) » dans son journal.

Perdre la clé privée rend les copies NAS illisibles : seules les copies locales restent alors utilisables.

### 2. DNS

Créer un enregistrement DNS (`A` et/ou `AAAA`) pour le domaine choisi (ici `backups.example.com`) vers l'IP du serveur. Avec Cloudflare, le laisser en **DNS only** (nuage gris) : derrière le proxy Cloudflare, l'application verrait les IP de Cloudflare au lieu de celles des clients (limitation des tentatives faussée), et le challenge HTTP de Let's Encrypt passerait par Cloudflare. Pour passer par un tunnel Cloudflare, voir « Derrière un tunnel ».

### 3. Dokploy

1. Nouveau projet → « Compose » → dépôt git de ce projet, fichier `docker-compose.yml`.
2. Variables d'environnement : générer la clé avec `openssl rand -base64 48` et la **conserver
   aussi dans votre gestionnaire de mots de passe**.

   ```
   DB_ENCRYPTION_KEY=<clé>
   ADMIN_EMAIL=<email>
   ADMIN_PASSWORD=<mot de passe long et unique, ≥ 12 caractères>
   APP_URL=https://backups.example.com
   NAS_AGE_RECIPIENTS=age1…
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

### Derrière un tunnel

Avec un tunnel Cloudflare (`cloudflared` → Traefik), Traefik doit faire confiance au réseau du
tunnel (`forwardedHeaders.trustedIPs: [10.0.1.0/24]` sur le point d'entrée, `dokploy-network`
chez Dokploy), et l'application aussi :

```
TRUSTED_PROXIES=10.0.1.0/24
```

`X-Forwarded-For` est alors lu depuis la droite : les adresses de ces plages sont sautées, la
première qui n'en fait pas partie est le client. Sans cette variable, l'application garde la
dernière valeur, c'est-à-dire l'adresse de `cloudflared` pour tout le monde. Refaire ensuite la
vérification ci-dessus.

## Restaurer un dump

Copie NAS chiffrée (`.age`) : la déchiffrer d'abord, avec la clé privée.

```bash
age -d -i ~/.config/backup-manager/age-identity.txt <fichier>.dump.age > <fichier>.dump
```

PostgreSQL (`.dump`) :

```bash
pg_restore -d "<URL de la base cible>" -v <fichier>.dump
```

MongoDB (`.archive.gz`) :

```bash
mongorestore --uri="<URL de la base cible>" --archive=<fichier> --gzip
```

MySQL / MariaDB (`.sql.gz`, recrée la base sous son nom d'origine) :

```bash
gzip -dc <fichier>.sql.gz | mariadb -h <hôte> -u <utilisateur> -p
```
