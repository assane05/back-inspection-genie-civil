import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SUPERVISOR_GROUPS = [
  "Supervisor 1",
  "Supervisor 2",
  "Supervisor 3",
  "Supervisor 4",
  "Supervisor 5",
];

const HORIZONTAL_FORM_TYPES: { code: string; name: string }[] = [
  { code: "apron", name: "Fiche d'inspection Apron" },
  { code: "runway", name: "Fiche d'inspection Runway" },
  { code: "taxiway", name: "Fiche d'inspection Taxiway" },
  { code: "parking", name: "Fiche d'inspection Parking" },
  {
    code: "service_gse_access_road",
    name: "Fiche d'inspection Service/GSE/Access Road",
  },
  {
    code: "chemin_ronde_interieur",
    name: "Fiche d'inspection Chemin de Ronde Intérieur",
  },
  {
    code: "chemin_ronde_exterieur",
    name: "Fiche d'inspection Chemin de Ronde Extérieur",
  },
  { code: "fence", name: "Fiche d'inspection Fence" },
  { code: "ouvrage", name: "Fiche d'inspection Ouvrage" },
  { code: "bande_piste_twy", name: "Fiche d'inspection Bande de piste TWY" },
  { code: "bande_piste_resa", name: "Fiche d'inspection Bande de piste RESA" },
];

const HORIZONTAL_FAMILIES = [
  "Déformations",
  "Fissures",
  "Arrachements",
  "Autres dégradations",
  "Autres constats",
];

const BUILDING_CATEGORIES: { code: string; label: string }[] = [
  { code: "A", label: "A - Murs / Cloisons" },
  { code: "B", label: "B - Structures" },
  { code: "C", label: "C - Menuiserie" },
  { code: "D", label: "D - Faux plafond / Étanchéité" },
  { code: "E", label: "E - Peinture" },
  { code: "F", label: "F - Carrelage" },
  { code: "G", label: "G - Toiture métallique" },
  { code: "H", label: "H - Descente EP" },
];

async function main() {
  for (const name of SUPERVISOR_GROUPS) {
    await prisma.group.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`${SUPERVISOR_GROUPS.length} groupes chargés.`);

  for (const ft of HORIZONTAL_FORM_TYPES) {
    const formType = await prisma.formType.upsert({
      where: { code_version: { code: ft.code, version: 1 } },
      update: { name: ft.name },
      create: {
        code: ft.code,
        name: ft.name,
        module: "horizontal",
        version: 1,
      },
    });

    for (const [i, label] of HORIZONTAL_FAMILIES.entries()) {
      const existing = await prisma.formSection.findFirst({
        where: { formTypeId: formType.id, label },
      });
      if (!existing) {
        await prisma.formSection.create({
          data: { formTypeId: formType.id, label, sortOrder: i },
        });
      }
    }
  }
  console.log(`${HORIZONTAL_FORM_TYPES.length} fiches horizontales chargées.`);

  const batiment = await prisma.formType.upsert({
    where: { code_version: { code: "batiment", version: 1 } },
    update: { name: "Fiche d'Inspection Bâtiment" },
    create: {
      code: "batiment",
      name: "Fiche d'Inspection Bâtiment",
      module: "vertical",
      version: 1,
    },
  });

  for (const [i, cat] of BUILDING_CATEGORIES.entries()) {
    const existing = await prisma.formSection.findFirst({
      where: { formTypeId: batiment.id, code: cat.code },
    });
    if (!existing) {
      await prisma.formSection.create({
        data: {
          formTypeId: batiment.id,
          code: cat.code,
          label: cat.label,
          sortOrder: i,
        },
      });
    }
  }
  console.log(
    `Fiche Bâtiment chargée avec ${BUILDING_CATEGORIES.length} catégories (A→H).`,
  );

  console.log(
    "\n Rappel [D2] : ce seed ne couvre que le socle explicitement nommé dans le schéma de référence. " +
      "Le catalogue complet des ~26 fiches, le dictionnaire des items (types de dégradation) et les segments " +
      "spatiaux par fiche doivent être validés avec les superviseurs avant tout chargement en environnement partagé.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
