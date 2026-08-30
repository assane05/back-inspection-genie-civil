import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TAXIWAY_SEGMENTS = [
  "Charlie - C1-C8",
  "Alpha - A1-A4",
  "Hotel & Golf",
  "Mike & Papa",
];

const TAXIWAY_SECTIONS: { label: string; items: string[] }[] = [
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
      "Depot de Gomme(Caoutchouc)",
      "Empreinte / Poinçonnement",
      "Enrobé Poreux",
      "Remontée de Fines",
      "Réparation Ponctuelle degradée",
      "Ressuage",
    ],
  },
  {
    label: "Autres constats",
    items: [
      "Présence d'herbes autour des parkings",
      "Présence de FOD",
      "Presence de contaminant",
    ],
  },
];

const BANDE_PISTE_SEGMENTS = [
  "Bandes de piste",
  "Bandes de TWY",
  "RESA",
  "Bande dégagée",
];

const BANDE_PISTE_ITEMS = [
  "Présence d'obstacles(pierres, regards en saillie, canal, bandes de sable, ouvrages infrangissable)",
  "Vérifier le développement de la végétation > 30 cm",
  "Vérifier le nivellement de la terre",
  "Vérifier les pentes de drainage",
  "Vérifier l'état des dalles des ouvrages enterrés",
  "Vérifier l'état des grilles avaloires au niveau des caniveaux",
  "Vérifier l'état des gardes corps au niveau des dalots et des déshuileurs",
  "Vérifier l'état des GRP au niveau des déshuileurs",
  "Vérifier l'état de de l'ouvrage des déshuileurs(voiles, couvercle)",
  "Vérifier l'état des échelles d'accès au nouveau des déshuileurs et des regards",
  "Vérifier l'état des talus des fossés(canaux à ciel ouvert)",
  "Vérifier l'état des joints de dilations",
  "Vérifier l'état du cercle de délimitation d'indicateur de vent(bloc de béton)",
  "Vérifier l'état des socles (bloc de béton) des panneaux d'indication",
  "Vérifier l'état des socles (bloc de béton) du localiser",
];

const TAXIWAY_BALISAGE_SEGMENTS = [
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "C6",
  "C7",
  "C8",
  "C",
  "A1",
  "A2",
  "A3",
  "A4",
  "A",
  "H",
  "M",
  "G",
  "P",
];

const TAXIWAY_BALISAGE_ITEMS = [
  "MARQUE DE POINT D'ATTENTE AVANT PISTE",
  "MARQUE DE POINT D'ATTENTE INTERMEDIAIRE",
  "MARQUE DE BORD DE TAXIWAY",
  "MARQUE D'AXE DE TAXIWAY",
];

const PARKING_SEGMENTS = [
  "TERMINAL PAYANT",
  "PAVILLON",
  "BARIERE SUD",
  "CARGO FRET",
  "BATIMENT ADMINISTRATIF",
];

const PARKING_ITEMS = [
  "MARQUE DE POSITION DE STATIONNEMENT",
  "MARQUE DE LIMITE DE STATIONNEMENT",
  "MARQUE DE FLECHE DIRECTIONNEL",
  "MARQUE DE STOP",
  "MARQUE D'INTERDICTION DE STATIONNEMENT",
  "MARQUE SUR BODURE",
  "SIGNALISATION VERTICALE OU PANNEAU (signifier le type de panneau et la nature de la dégradation)",
];

async function rebuildFormType(opts: {
  code: string;
  name: string;
  module: "horizontal" | "vertical";
  segments: string[];
  sections: { label: string; items: string[] }[];
}) {
  const formType = await prisma.formType.upsert({
    where: { code_version: { code: opts.code, version: 1 } },
    update: { name: opts.name, module: opts.module },
    create: {
      code: opts.code,
      name: opts.name,
      module: opts.module,
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
    code: "taxiway",
    name: "Fiche d'Inspection Voie de Circulation d'Aéronef / Taxiway",
    module: "horizontal",
    segments: TAXIWAY_SEGMENTS,
    sections: TAXIWAY_SECTIONS,
  });
  console.log("taxiway (FI) — reconstruit.");

  await rebuildFormType({
    code: "bande_piste_twy",
    name: "Fiche d'Inspection des Bandes de Piste - TWY - Bandes Dégagées et RESA",
    module: "horizontal",
    segments: BANDE_PISTE_SEGMENTS,
    sections: [{ label: "Actions", items: BANDE_PISTE_ITEMS }],
  });
  console.log("bande_piste_twy (FI) — reconstruit.");

  await rebuildFormType({
    code: "taxiway_balisage",
    name: "Fiche d'Inspection Balisage diurne Aire de Manœuvre / Taxiway",
    module: "horizontal",
    segments: TAXIWAY_BALISAGE_SEGMENTS,
    sections: [
      { label: "Les types de marquage", items: TAXIWAY_BALISAGE_ITEMS },
    ],
  });
  console.log("taxiway_balisage (FIB) — reconstruit.");

  await rebuildFormType({
    code: "parking_balisage",
    name: "Fiche d'Inspection Balisage diurne des Parkings",
    module: "horizontal",
    segments: PARKING_SEGMENTS,
    sections: [{ label: "Les types de marquage", items: PARKING_ITEMS }],
  });
  console.log(
    "parking_balisage (FIB) — reconstruit (Parking n'a pas de fiche FI dégradation).",
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
