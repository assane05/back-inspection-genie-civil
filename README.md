# LAS Inspections — API

le backend qui est connecté avec le front fait avec nodejs, prisma, express, postgresSql

## Démarrage

```bash
cp .env.example .env

#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up -d        # Postgres local (identifiants déjà dans .env.example)

npm install
npm run prisma:migrate      # las comme nom
npm run seed                # ChangeMe123!
npm run dev                 # API sur http://localhost:4000
```

## Sécurité — à ne pas oublier avant toute mise en production

- Générer un vrai `JWT_SECRET` (voir ci-dessus) — le refus est automatique
  si `NODE_ENV=production` et que la valeur par défaut est encore présente.
- Changer/désactiver `DEMO_SEED_PASSWORD` une fois les vrais comptes créés.
- `npm run prisma:migrate` est réservé au développement local
  (`prisma migrate dev`, peut réinitialiser des données) — en production,
  utiliser uniquement `npm run prisma:migrate:deploy`.
