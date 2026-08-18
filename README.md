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

- Changer/désactiver `DEMO_SEED_PASSWORD`
