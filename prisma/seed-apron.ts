import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Transcrit depuis FICHE_INDIVIDUELLE_DINSPECTION.rar / APRON.
 * Note : les zones diffèrent légèrement entre FI et FIB (ex. "Juillet 1" vs
 * "JULIETTE 1", "NOV" vs "NOVEMBER") — transcrites telles quelles, fiche par
 * fiche, sans harmoniser (fidélité au document réel).
 */

const FI_SEGMENTS = [
  "TANGO",
  "Juillet 1",
  "Juillet 2",
  "NOV",
  "AVG",
  "VIP",
  "VICTOR",
];

const FI_SECTIONS: { label: string; items: string[] }[] = [
  {
    label: "Dégradations de Structure",
    items: [
      "Fissure(longitudinale,transversale,oblique)",
      "Fissure en coin / Cassure d'angle",
      "Fracture",
      "Pompage",
      "Décalage / Marche",
    ],
  },
  {
    label: "Dégradations de Surface",
    items: ["Epaufrure", "Faiençage / Ecaillage", "Defaut de joint"],
  },
  {
    label: "Autres degradations",
    items: ["Reparation ponctuelle degradée"],
  },
  {
    label: "Autres constats",
    items: [
      "Présence d'herbes autour des parkings",
      "Présence de FOD",
      "Dommage des poteaux de protection(VDGS,Borne Kérosène,mat projecteur,poteaux supports passerelles télescopiques)",
      "Présence de contaminant",
    ],
  },
];

const FIB_SEGMENTS = [
  "TANGO",
  "JULIETTE 1",
  "JULIETTE 2",
  "AVG",
  "NOVEMBER",
  "VICTOR",
  "AIRCRAFT MAINTENANCE",
  "VVIP",
];

const FIB_ITEMS = [
  "MARQUE DE LIGNE DE SECURITE D'AIRE DE TRAFIC",
  "MARQUE DE ZONE D'EVOLUTION CONTROLEE (ZEC)",
  "MARQUE DE TAXILINE",
  "MARQUE DE BARRE DE STOP",
  "MARQUE DE TYPE D'AERONEF",
  "MARQUE DE POSTE DE STATIONNEMENT",
  "MARQUE DE DELIMITATION DE L'AIRE DE TRAFIC",
  "MARQUE DE ZONE DE STOCKAGE HANDLING",
  "MARQUE D'INTERDICTION DE STATIONNEMENT",
  "MARQUE DE POSITION DE STATIONNEMENT DE BRIDGE",
  "MARQUE DE PROTECTION DES INSTALLATIONS",
  "MARQUE DE ZONE DE SECURITE D'AVITAILLEMENT (FUEL HYDRANT)",
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
    code: "apron",
    name: "Fiche d'Inspection Aire de Trafic / Apron",
    segments: FI_SEGMENTS,
    sections: FI_SECTIONS,
  });
  console.log("apron (FI) : 4 sections, 12 items, 7 zones — reconstruit.");

  await rebuildFormType({
    code: "apron_balisage",
    name: "Fiche d'Inspection Balisage diurne Aire de Trafic / Apron",
    segments: FIB_SEGMENTS,
    sections: [{ label: "Les types de marquage", items: FIB_ITEMS }],
  });
  console.log("apron_balisage (FIB) : 12 items, 8 zones — reconstruit.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
