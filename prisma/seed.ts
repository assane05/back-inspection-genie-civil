import { env } from "../src/env";
import { prisma } from "../src/prisma";
import { hashPassword } from "../src/lib/password";
import {
  DICTIONARY_DEFAULTS,
  DICTIONARY_KEYS,
} from "../src/lib/dictionary-defaults";

const SUPERVISOR_GROUPS = [
  "Supervisor 1",
  "Supervisor 2",
  "Supervisor 3",
  "Supervisor 4",
  "Supervisor 5",
];

async function main() {
  const passwordHash = await hashPassword(env.demoSeedPassword);

  const users = [
    {
      id: "u-admin-1",
      name: "Approver 1",
      username: "approver1",
      email: "approver1@las.aero",
      role: "admin" as const,
      groups: [...SUPERVISOR_GROUPS],
      initials: "A1",
    },
    ...SUPERVISOR_GROUPS.map((group, i) => ({
      id: `u-supervisor-${i + 1}`,
      name: `Supervisor ${i + 1}`,
      username: `supervisor${i + 1}`,
      email: `supervisor${i + 1}@las.aero`,
      role: "supervisor" as const,
      groups: [group],
      initials: `S${i + 1}`,
    })),
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { ...u, passwordHash },
      create: { ...u, passwordHash, isActive: true },
    });
  }

  console.log(`${users.length} comptes de démonstration créés/mis à jour.`);
  console.log(`Mot de passe (tous comptes) : ${env.demoSeedPassword}`);

  for (const key of DICTIONARY_KEYS) {
    const existing = await prisma.dictionaryEntry.findFirst({ where: { key } });
    if (existing) continue;
    await prisma.dictionaryEntry.create({
      data: {
        key,
        data: DICTIONARY_DEFAULTS[key],
        version: 1,
      },
    });
  }
  console.log(`Dictionnaires initialisés : ${DICTIONARY_KEYS.join(", ")}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
