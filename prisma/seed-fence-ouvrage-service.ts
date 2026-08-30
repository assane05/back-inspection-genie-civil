import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FENCE_ITEMS = [
  "Vérifier l'état du grillage souple",
  "Vérifier l'état de poteaux et des fixations",
  "Vérifier l'état des retours défensifs",
  "Vérifier l'état des jambes de forces ou raidisseurs",
  "Vérifier l'existence de brèches",
  "Vérifier l'état des barbelés",
  "Vérifier l'état des bavolets",
  "Vérifier l'état du concertina",
  "Vérifier l'état des tendeurs",
  "Vérifier l'état des fils de tension",
  "Vérifier l'état des fils d'attache barbelés-concertina",
  "Vérifier le respect de la hauteur de clôture",
  "Vérifier l'état des portes et leurs fixations au niveau de la grille",
  "Vérifier l'état des connections entre bâtiments et la grille",
  "Vérifier l'état des grilles au niveau des connexions entre canaux et la clôture",
  "Vérifier l'état du remblais contre fondation de la clôture",
  "Vérifier l'état du terrassement le long de clôture",
  "Vérifier l'état du chainage bas le long de clôture",
];

const OUVRAGE_SEGMENTS = [
  "Ditches (Canaux à Ciel Ouvert)",
  "Box Culvert - Pipe Culvert",
  "Oil Separator",
  "Uchannel - Grated Channel",
  "Manholes",
];

const OUVRAGE_ITEMS = [
  "Vérifier l'état de fissuration des ouvrages",
  "Vérifier l'état des grilles tampon au niveau des regards cheminés",
  "Vérifier l'état de connexion entre dalot/fossée et entre dalot/buses et dalot/canal",
  "Vérifier l'état des grilles pour la fermeture des brèches au niveau de dallots et buses",
  "Vérifier les affaissements ou soulévements au niveau des ouvrages et surtout au niveau des connexions",
  "Vérifier l'état des dalles des ouvrages enterrés",
  "Vérifier l'état des grilles avaloires au niveau des caniveaux",
  "Vérifier l'état des gardes corps au niveau des dalots et des déshuileurs",
  "Vérifier l'état des GRP au niveau des déshuileurs",
  "Vérifier l'état des échelles d'accès au niveau des deshuileurs et des regards",
  "Vérifier l'état des talus des fossées",
  "Vérifier l'état des joints de dilations",
];

const SERVICE_ROAD_SEGMENTS = [
  "SR1",
  "SR2",
  "SR3",
  "SR4",
  "SR5",
  "SR6",
  "SR7",
  "SR8",
  "GSE ROAD",
];

const SERVICE_ROAD_SECTIONS: { label: string; items: string[] }[] = [
  {
    label: "Famille des déformations",
    items: [
      "Flache",
      "Ornière /frayée",
      "Déformation en W",
      "Gonflement /Bourrelet",
      "Tassement Différentiel/ Marche",
    ],
  },
  {
    label: "Famille des Fissures",
    items: [
      "Fissure de Fatigue",
      "Faïençage de Fatigue",
      "Fissure de joint",
      "Fissure de retrait",
      "Faïençage de retrait",
      "Fissure paraboliques /Enrobé Tiré",
    ],
  },
  {
    label: "Famille des Arrachements",
    items: ["Désenrobage / Brulure", "Pelade", "Nid de Poule"],
  },
  {
    label: "Autres dégradations",
    items: [
      "Contamination /Souillure",
      "Empreinte / Poinçonnement",
      "Enrobé Poreux",
      "Remontée de Fines",
      "Réparation Ponctuelle dégradée",
      "Ressuage",
    ],
  },
  {
    label: "Autres constats",
    items: [
      "Présence d'herbes autour des parkings",
      "Présence de FOD",
      "Présence de contaminant",
    ],
  },
];

const SERVICE_ROAD_BALISAGE_SEGMENTS = [
  "SR1",
  "SR2",
  "SR3",
  "SR4",
  "SR5",
  "SR6",
  "SR7",
  "SR8",
  "PSR2",
];

const SERVICE_ROAD_BALISAGE_ITEMS = [
  "MARQUE DE POINT D'ATTENTE SUR VOIE DE SERVICE",
  "MARQUE DE BORD DE VOIE DE SERVICE (LIGNE DE RIVE)",
  "MARQUE DE LIMITATION DE VITESSE",
  'MARQUE DE STOP (BARRE + "STOP")',
  "MARQUE DE LIGNE CONTINUE (AXE DE ROUTE)",
  "MARQUE DE LIGNE DISCONTINUE (AXE DE ROUTE)",
  "MARQUE LIGNE D'ANNONCE",
  "MARQUE DE FLECHE DIRECTIONNEL",
  "PASSAGE PIETON",
  "MARQUE DE PROTECTION VERTICAL",
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
    code: "fence",
    name: "Fiche d'Inspection Aire de Trafic Chain Link Fence / Grillage et Clôture",
    segments: [],
    sections: [{ label: "Actions", items: FENCE_ITEMS }],
  });
  console.log("fence (FI) — reconstruit.");

  await rebuildFormType({
    code: "ouvrage",
    name: "Fiche d'Inspection des Ouvrages Semi Enterrés",
    segments: OUVRAGE_SEGMENTS,
    sections: [{ label: "Actions", items: OUVRAGE_ITEMS }],
  });
  console.log("ouvrage (FI) — reconstruit.");

  await rebuildFormType({
    code: "service_gse_access_road",
    name: "Fiche d'Inspection Aire de Trafic / Services Roads et GSE Road",
    segments: SERVICE_ROAD_SEGMENTS,
    sections: SERVICE_ROAD_SECTIONS,
  });
  console.log("service_gse_access_road (FI) — reconstruit.");

  await rebuildFormType({
    code: "service_road_balisage",
    name: "Fiche d'Inspection Balisage diurne Service Road + Chemin de Ronde Intérieur",
    segments: SERVICE_ROAD_BALISAGE_SEGMENTS,
    sections: [
      { label: "Les types de marquage", items: SERVICE_ROAD_BALISAGE_ITEMS },
    ],
  });
  console.log("service_road_balisage (FIB) — reconstruit.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
