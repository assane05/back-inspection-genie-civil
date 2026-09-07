import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Données transcrites EXACTEMENT depuis les fiches réelles fournies
 * (FICHE_INDIVIDUELLE_DINSPECTION.rar / RUNWAY). Deux fiches distinctes :
 *  - "runway" (FI) : dégradations physiques, 4 familles, 21 items,
 *    + section "Autres constats" (Oui/Non), 3 segments (tiers de piste).
 *  - "runway_balisage" (FIB) : marquage au sol, 1 famille, 9 items,
 *    5 items exclus de la zone "2/3" (cellules grisées sur le PDF).
 *
 * Idempotent : supprime puis recrée les sections/segments de ces deux
 * fiches à chaque exécution — seule façon fiable de garantir la fidélité
 * "identique au document" sans dérive au fil des ré-exécutions.
 */

const RUNWAY_SEGMENTS = [
  "1/3 Piste et Accotement",
  "2/3 Piste et Accotement",
  "3/3 Piste et Accotement",
];

const RUNWAY_SECTIONS: { label: string; items: string[] }[] = [
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
    // Section "AUTRES CONSTATS" du PDF — grille Oui/Non, pas Négligeable/
    // Mineur/Majeur. Mêmes zones que le reste de la fiche.
    label: "Autres constats",
    items: [
      "Présence d'herbes autour des parkings",
      "Présence de FOD",
      "Presence de contaminant",
    ],
  },
];

const BALISAGE_SEGMENTS = ["1/3", "2/3", "3/3"];

const BALISAGE_ITEMS: { label: string; excludeFromSegment23: boolean }[] = [
  { label: "MARQUE D'AIRE AVANT SEUIL (CHEVRON)", excludeFromSegment23: true },
  { label: "MARQUE LATERALE DE PISTE", excludeFromSegment23: false },
  { label: "MARQUE DE SEUIL DE PISTE", excludeFromSegment23: true },
  { label: "MARQUE D'IDENTIFICATION DE PISTE", excludeFromSegment23: true },
  { label: "MARQUE D'AXE DE PISTE", excludeFromSegment23: false },
  {
    label: "MARQUE DE LIGNE DE GUIDAGE (ENTREE ET SORTIE DE PISTE)",
    excludeFromSegment23: false,
  },
  { label: "MARQUE DE ZONE DE TOUCHER DES ROUES", excludeFromSegment23: true },
  { label: "MARQUE DE POINT CIBLE", excludeFromSegment23: false },
  { label: "MARQUE D'INDICATEUR DE VENT", excludeFromSegment23: true },
];

// async function rebuildFormType(opts: {
//   code: string;
//   name: string;
//   segments: string[];
//   sections: { label: string; items: string[] }[];
// }) {
//   const formType = await prisma.formType.upsert({
//     where: { code_version: { code: opts.code, version: 1 } },
//     update: { name: opts.name, module: "horizontal" },
//     create: {
//       code: opts.code,
//       name: opts.name,
//       module: "horizontal",
//       version: 1,
//     },
//   });

//   // Repart d'une base propre pour ces deux fiches (cascade sur items/segments).
//   await prisma.formSection.deleteMany({ where: { formTypeId: formType.id } });
//   await prisma.formSegment.deleteMany({ where: { formTypeId: formType.id } });

//   const segmentsByLabel = new Map<string, string>();
//   for (const [i, label] of opts.segments.entries()) {
//     const seg = await prisma.formSegment.create({
//       data: { formTypeId: formType.id, label, sortOrder: i },
//     });
//     segmentsByLabel.set(label, seg.id);
//   }

//   for (const [si, section] of opts.sections.entries()) {
//     const sec = await prisma.formSection.create({
//       data: { formTypeId: formType.id, label: section.label, sortOrder: si },
//     });
//     for (const [ii, label] of section.items.entries()) {
//       await prisma.formItem.create({
//         data: { sectionId: sec.id, label, sortOrder: ii },
//       });
//     }
//   }

//   return { formType, segmentsByLabel };
// }

async function rebuildFormType(opts: {
  code: string;
  name: string;
  segments: string[];
  sections: { label: string; items: string[] }[];
}) {
  const formType = await prisma.formType.upsert({
    where: {
      code_version: {
        code: opts.code,
        version: 1,
      },
    },
    update: {
      name: opts.name,
      module: "horizontal",
    },
    create: {
      code: opts.code,
      name: opts.name,
      module: "horizontal",
      version: 1,
    },
  });

  // Repart d'une base propre pour cette fiche.
  //
  // Les InspectionValue doivent être supprimées en premier,
  // car elles référencent les FormItem et les FormSegment
  // sans onDelete: Cascade.
  //
  // Les InspectionPhoto et CorrectiveAction associés seront
  // supprimés automatiquement grâce à leur relation Cascade.
  await prisma.inspectionValue.deleteMany({
    where: {
      OR: [
        {
          item: {
            section: {
              formTypeId: formType.id,
            },
          },
        },
        {
          segment: {
            formTypeId: formType.id,
          },
        },
      ],
    },
  });

  // Les FormItemSegmentExclusion et FormItem associés
  // seront supprimés en cascade avec les sections.
  await prisma.formSection.deleteMany({
    where: {
      formTypeId: formType.id,
    },
  });

  // Aucun InspectionValue ne référence maintenant les segments.
  await prisma.formSegment.deleteMany({
    where: {
      formTypeId: formType.id,
    },
  });

  const segmentsByLabel = new Map<string, string>();

  for (const [i, label] of opts.segments.entries()) {
    const seg = await prisma.formSegment.create({
      data: {
        formTypeId: formType.id,
        label,
        sortOrder: i,
      },
    });

    segmentsByLabel.set(label, seg.id);
  }

  for (const [si, section] of opts.sections.entries()) {
    const sec = await prisma.formSection.create({
      data: {
        formTypeId: formType.id,
        label: section.label,
        sortOrder: si,
      },
    });

    for (const [ii, label] of section.items.entries()) {
      await prisma.formItem.create({
        data: {
          sectionId: sec.id,
          label,
          sortOrder: ii,
        },
      });
    }
  }

  return {
    formType,
    segmentsByLabel,
  };
}

async function main() {
  await rebuildFormType({
    code: "runway",
    name: "Fiche d'Inspection Aire de Manœuvre / Runway 01-19",
    segments: RUNWAY_SEGMENTS,
    sections: RUNWAY_SECTIONS,
  });
  console.log(
    "runway (FI) : 4 familles + Autres constats, 24 items, 3 segments — reconstruit.",
  );

  const { formType: balisage, segmentsByLabel } = await rebuildFormType({
    code: "runway_balisage",
    name: "Fiche d'Inspection Balisage diurne / Runway 01-19",
    segments: BALISAGE_SEGMENTS,
    sections: [
      {
        label: "Les types de marquage",
        items: BALISAGE_ITEMS.map((i) => i.label),
      },
    ],
  });

  const items = await prisma.formItem.findMany({
    where: { section: { formTypeId: balisage.id } },
  });
  const segment23Id = segmentsByLabel.get("2/3")!;
  let exclusions = 0;
  for (const item of items) {
    const spec = BALISAGE_ITEMS.find((i) => i.label === item.label);
    if (spec?.excludeFromSegment23) {
      await prisma.formItemSegmentExclusion.create({
        data: { itemId: item.id, segmentId: segment23Id },
      });
      exclusions += 1;
    }
  }
  console.log(
    `runway_balisage (FIB) : 9 items, 3 segments, ${exclusions} exclusion(s) (cellules grisées) — reconstruit.`,
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
