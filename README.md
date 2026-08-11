# LAS Inspections — API (phase 1 : socle + authentification)

## Démarrage

```bash
cp .env.example .env
# éditer .env : générer un vrai JWT_SECRET avec
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up -d        # Postgres local (identifiants déjà dans .env.example)

npm install
npm run prisma:migrate      # crée les tables (première fois : nomme la migration, ex. "init")
npm run seed                # crée les comptes de démonstration (voir mot de passe affiché)
npm run dev                 # API sur http://localhost:4000
```

Vérification rapide : `curl http://localhost:4000/health` → `{"ok":true}`.

## Brancher le frontend dessus

Dans `polish-project-joy-main`, définir la variable d'environnement :

```
VITE_AUTH_API_URL=http://localhost:4000
```

`src/lib/auth-api.ts` bascule alors automatiquement du mode démo (annuaire en
mémoire) vers de vrais appels réseau (`/auth/login`, `/auth/logout`) — aucun
autre changement requis côté frontend pour cette phase.

## Ce qui est fait (phases 1 à 3)

- Schéma Prisma complet (`prisma/schema.prisma`) : `User`, `Task`,
  `Submission`, `Photo`, `DictionaryEntry` — miroir des types déjà établis
  côté frontend (voir les commentaires dans le schéma).
- Authentification réelle : mots de passe hachés (bcrypt), cookie de session
  httpOnly signé (JWT), `POST /auth/login`, `POST /auth/logout`,
  `GET /auth/me`. Un compte désactivé (`isActive: false`) ne peut plus se
  connecter.
- CORS configuré avec `credentials: true` (obligatoire, le frontend envoie
  `credentials: "include"`).
- **Tâches** (`/tasks`) : liste avec filtres, création en lot (zone ×
  groupe), édition, suppression. Un superviseur ne voit et ne peut agir que
  sur les tâches de ses propres groupes.
- **Dictionnaire versionné** (`/dictionary/:key`) : lecture (tout
  utilisateur connecté), écriture et réinitialisation (admin uniquement),
  version incrémentée à chaque écriture.
- **Soumissions** (`/submissions`) : `POST /submissions` remplace
  `enqueueSubmission(...)` côté frontend — décode et stocke chaque photo
  (data URL → fichier sur disque + URL stable, `src/lib/photo-storage.ts`,
  testé de bout en bout), fait passer la tâche en statut `pending`,
  **et surtout : `submittedBy` est désormais l'utilisateur authentifié et
  `submittedAt` l'horloge serveur — plus jamais des valeurs envoyées par le
  client.** Ça résout définitivement la limite documentée dans
  `task-status.ts` côté frontend (sprint 12). `GET /submissions?taskId=`
  (historique) et `GET /submissions/:id` (détail, pour export PDF/galerie)
  disponibles.
- **Utilisateurs** (`/users`, admin uniquement) : liste, création avec vrai
  mot de passe (haché, jamais stocké en clair), édition (profil, rôle,
  groupes, mot de passe), désactivation/réactivation, suppression (comptes
  de démonstration protégés — désactivables seulement). Impossible de se
  désactiver soi-même.
- Photos servies en statique depuis `/uploads` (stockage disque — migration
  S3/R2 prévue en changeant uniquement `photo-storage.ts`, jamais l'URL
  publique ni les appelants).
- Seed (`npm run seed`) : 6 comptes de démonstration + les 3 dictionnaires
  initialisés (sans jamais écraser une personnalisation déjà enregistrée).

## Ce qui reste

Le socle fonctionnel prévu est maintenant complet côté backend. Reste le
travail d'intégration côté **frontend** : remplacer progressivement les
stores `localStorage` (`task-status.ts`, `admin-tasks.ts`,
`dictionary-store.ts`, `user-directory.ts`, `offline-queue.ts`) par de vrais
appels à cette API — voir la section suivante pour le détail des
correspondances.

## Correspondance frontend → endpoints (pour la phase d'intégration)

| Frontend (localStorage)                                                                                          | Backend (à brancher)                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `VITE_AUTH_API_URL` non défini → mode démo                                                                       | Définir `VITE_AUTH_API_URL=http://localhost:4000`                                    |
| `src/lib/admin-tasks.ts#listAllTasks/createTasks/deleteTask`                                                     | `GET/POST/DELETE /tasks`                                                             |
| `src/lib/task-status.ts#submitTask`                                                                              | Automatique : `POST /submissions` fait déjà passer la tâche en `pending`             |
| `src/lib/dictionary-store.ts` (families/fiche-catalog/building-categories)                                       | `GET/PUT /dictionary/:key`, `POST /dictionary/:key/reset`                            |
| `src/lib/offline-queue.ts#enqueueSubmission("/api/public/inspections"\|"/api/public/building-inspections", ...)` | `POST /submissions` (même payload, `submittedBy`/`submittedAt` ignorés côté serveur) |
| `src/lib/user-directory.ts`                                                                                      | `GET/POST/PATCH/DELETE /users`                                                       |

## Limite connue de cet environnement de développement (sandbox)

`npx prisma generate`/`migrate` n'a pas pu être exécuté dans l'environnement
où ce code a été écrit : Prisma télécharge ses moteurs natifs depuis
`binaries.prisma.sh`, domaine bloqué par le sandbox. Le schéma a été validé
autrement (DDL SQL équivalent appliqué directement sur Postgres avec un
smoke-test bout en bout) et `tsc` ne remonte aucune erreur en dehors du
typage généré par Prisma. Sur une machine avec un accès réseau normal
(la tienne), `npm install` + `npm run prisma:migrate` fonctionneront
normalement — c'est une restriction du bac à sable, pas un défaut du code.

## Sécurité — à ne pas oublier avant toute mise en production

- Générer un vrai `JWT_SECRET` (voir ci-dessus) — le refus est automatique
  si `NODE_ENV=production` et que la valeur par défaut est encore présente.
- Changer/désactiver `DEMO_SEED_PASSWORD` une fois les vrais comptes créés.
- `npm run prisma:migrate` est réservé au développement local
  (`prisma migrate dev`, peut réinitialiser des données) — en production,
  utiliser uniquement `npm run prisma:migrate:deploy`.
