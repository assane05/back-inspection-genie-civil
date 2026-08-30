import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Transcrit depuis FICHE_INDIVIDUELLE_DINSPECTION.rar.
 * CHEMIN DE RONDE (INT et EXT) et ACCES ROAD partagent la même structure :
 * pas de segments, une seule colonne de dégradation + "LIEU" libre.
 * Note : le item #16 ("Depot de Gomme") est absent de la numérotation
 * d'origine sur ces 3 fiches (saut 15→17 dans le PDF) — non reproduit
 * comme un trou volontaire, juste absent de la liste réelle des items.
 */

const COMMON_SECTIONS: { label: string; items: string[] }[] = [
  {
    label: "Famille des déformations",
    items: [
      "Flache",
      "Ornière /frayée",
      "Déformation en W",
      "Gonflement /Bourrelet",
      "Tassement Differentiel/ Marche",
    ],
  },
  {
    label: "Famille des Fissures",
    items: [
      "Fissure de Fatigue",
      "Faiençage de Fatigue",
      "Fissure de joint",
      "Fissure de retrait",
      "Faiençage de retrait",
      "Fissure paraboliques /Enrobé Tiré",
    ],
  },
  {
    label: "Famille des Arrachements",
    items: ["Désenrobage / Brulure", "Pélade", "Nid de Poule"],
  },
  {
    label: "Autres degradations",
    items: [
      "Contamination /Souillure",
      "Empreinte / Poinçonnement",
      "Enrobé Poreux",
      "Remontée de Fines",
      "Réparation Ponctuelle degradée",
      "Ressuage",
    ],
  },
];

const ACCES_ROAD_AUTRES_CONSTATS = [
  "Présence d'herbes autour des parkings",
  "Présence de graviots",
  "Presence de contaminant",
];

const BALISAGE_SEGMENTS = [
  "PAR1",
  "PAR2",
  "AAR1",
  "AAR2",
  "AAR3",
  "AAR4",
  "AAR5",
  "CAR",
  "PSR1",
];

const BALISAGE_ITEMS = [
  "MARQUE DE BORD DE VOIE DE SERVICE (LIGNE DE RIVE)",
  "MARQUE DE LIMITATION DE VITESSE",
  "MARQUE DE STOP",
  "MARQUE DE LIGNE CONTINUE (AXE DE ROUTE)",
  "MARQUE DE LIGNE DISCONTINUE (AXE DE ROUTE)",
  "MARQUE LIGNE D'ANNONCE",
  "MARQUE DE FLECHE DIRECTIONNEL",
  "PASSAGE PIETON",
  "MARQUE SUR RALENTISSEUR",
  "MARQUE SUR BORDURE",
  "SIGNALISATION VERTICALE OU PANNEAU (signifier le type de panneau et la nature de la dégradation)",
];

async function rebuildFormType(opts: {
  code: string;
  name: string;
  segments: string[];
  sections: { label: string; items: string[] }[];
}) {
  const formType = await prisma.formType.upsert({
    where: { code_version: { code: opts.code, version: 1 } },
    update: { name: opts.name, module: "horizontal" },
    create: {
      code: opts.code,
      name: opts.name,
      module: "horizontal",
      version: 1,
    },
  });
  await prisma.formSection.deleteMany({ where: { formTypeId: formType.id } });
  await prisma.formSegment.deleteMany({ where: { formTypeId: formType.id } });
  for (const [i, label] of opts.segments.entries()) {
    await prisma.formSegment.create({
      data: { formTypeId: formType.id, label, sortOrder: i },
    });
  }
  for (const [si, section] of opts.sections.entries()) {
    const sec = await prisma.formSection.create({
      data: { formTypeId: formType.id, label: section.label, sortOrder: si },
    });
    for (const [ii, label] of section.items.entries()) {
      await prisma.formItem.create({
        data: { sectionId: sec.id, label, sortOrder: ii },
      });
    }
  }
  return formType;
}

async function main() {
  await rebuildFormType({
    code: "chemin_ronde_interieur",
    name: "Fiche d'Inspection Chemin de Ronde Intérieur",
    segments: [],
    sections: [
      ...COMMON_SECTIONS,
      { label: "Autres constats", items: ACCES_ROAD_AUTRES_CONSTATS },
    ],
  });
  console.log("chemin_ronde_interieur (FI) — reconstruit.");

  await rebuildFormType({
    code: "chemin_ronde_exterieur",
    name: "Fiche d'Inspection des Voies de Circulation Extérieures (Chemin de Ronde)",
    segments: [],
    sections: [
      ...COMMON_SECTIONS,
      { label: "Autres constats", items: ACCES_ROAD_AUTRES_CONSTATS },
    ],
  });
  console.log("chemin_ronde_exterieur (FI) — reconstruit.");

  await rebuildFormType({
    code: "acces_road",
    name: "Fiche d'Inspection des Voies de Circulation Extérieures (Accès Road)",
    segments: [],
    sections: [
      ...COMMON_SECTIONS,
      { label: "Autres constats", items: ACCES_ROAD_AUTRES_CONSTATS },
    ],
  });
  console.log("acces_road (FI) — reconstruit.");

  await rebuildFormType({
    code: "acces_road_balisage",
    name: "Fiche d'Inspection Balisage diurne Accès Road / Perimeter Security Road 1",
    segments: BALISAGE_SEGMENTS,
    sections: [{ label: "Les types de marquage", items: BALISAGE_ITEMS }],
  });
  console.log(
    "acces_road_balisage (FIB) — reconstruit (couvre aussi Chemin de Ronde Ext PSR1).",
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
