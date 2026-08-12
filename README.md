# LAS Inspections — API

le backend qui est connecté avec le front fait avec nodejs, prisma, express, postgresSql

## Démarrage

```bash

#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up -d

npm install
npm run prisma:migrate
npm run seed
npm run dev
```

## Sécurité — à ne pas oublier avant toute mise en production

- Générer un vrai `JWT_SECRET`
  si `NODE_ENV=production` et que la valeur par défaut est encore présente.
- Changer/désactiver `DEMO_SEED_PASSWORD`
