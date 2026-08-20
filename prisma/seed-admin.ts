import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { env } from "../src/env";

const prisma = new PrismaClient();

/**
 * Comptes de démonstration pour tester l'app de bout en bout :
 * - un administrateur (accès /dashboard)
 * - un superviseur rattaché à "Supervisor 1" (accès /supervisor/tasks)
 * - une assignation "Runway" pour ce superviseur, sinon l'écran des tâches
 *   serait vide (prisma/seed.ts ne crée que les données de référence, aucun
 *   compte ni aucune assignation).
 *
 * Le champ email du formulaire de login exige un "@" (type="email" côté
 * front) : les comptes ci-dessous ont donc un email même si le backend
 * accepte aussi bien username qu'email pour se connecter.
 *
 * Idempotent — se relance sans effet si tout existe déjà. Mot de passe
 * identique pour les deux comptes, à changer après le premier login en
 * environnement partagé.
 */
async function ensureUser(opts: {
  username: string;
  email: string;
  displayName: string;
  role: "administrateur" | "superviseur";
}) {
  const existing = await prisma.user.findUnique({
    where: { username: opts.username },
  });
  if (existing) {
    if (!existing.email) {
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: { email: opts.email },
      });
      console.log(
        `Compte '${opts.username}' complété avec l'email manquant : ${opts.email}`,
      );
      return updated;
    }
    console.log(
      `Compte '${opts.username}' déjà présent (email : ${existing.email}).`,
    );
    return existing;
  }
  const passwordHash = await hashPassword(env.demoSeedPassword);
  const user = await prisma.user.create({
    data: {
      username: opts.username,
      email: opts.email,
      displayName: opts.displayName,
      passwordHash,
      role: opts.role,
    },
  });
  console.log(
    `Compte '${opts.username}' créé — connectez-vous avec : ${opts.email}`,
  );
  return user;
}

async function main() {
  await ensureUser({
    username: "admin",
    email: "admin@las.local",
    displayName: "Administrateur",
    role: "administrateur",
  });

  const supervisor = await ensureUser({
    username: "superviseur1",
    email: "superviseur1@las.local",
    displayName: "Superviseur Un",
    role: "superviseur",
  });

  const group = await prisma.group.findUnique({
    where: { name: "Supervisor 1" },
  });
  if (!group) {
    console.warn(
      "Groupe 'Supervisor 1' introuvable — lancez d'abord `npm run seed`.",
    );
  } else {
    await prisma.userGroup.upsert({
      where: { userId_groupId: { userId: supervisor.id, groupId: group.id } },
      update: {},
      create: { userId: supervisor.id, groupId: group.id },
    });

    const formType = await prisma.formType.findUnique({
      where: { code_version: { code: "runway", version: 1 } },
    });
    if (!formType) {
      console.warn(
        "Fiche 'runway' introuvable — lancez d'abord `npm run seed`.",
      );
    } else {
      const existingAssignment = await prisma.assignment.findFirst({
        where: {
          formTypeId: formType.id,
          groupId: group.id,
          year: 2026,
          bimonthlyPeriod: 5,
        },
      });
      if (!existingAssignment) {
        await prisma.assignment.create({
          data: {
            formTypeId: formType.id,
            groupId: group.id,
            year: 2026,
            bimonthlyPeriod: 5,
            zoneNotes: "Zone de test",
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        console.log("Assignation de test créée (fiche Runway, Supervisor 1).");
      } else {
        console.log("Assignation de test déjà présente.");
      }
    }
  }

  console.log(`\nMot de passe des deux comptes : ${env.demoSeedPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
