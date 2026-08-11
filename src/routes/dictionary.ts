import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  isDictionaryKey,
  DICTIONARY_DEFAULTS,
  type DictionaryKey,
} from "../lib/dictionary-defaults";

export const dictionaryRouter = Router();

dictionaryRouter.use(requireAuth);

function keyParam(raw: string): DictionaryKey | null {
  return isDictionaryKey(raw) ? raw : null;
}

/** Dernière version enregistrée pour une clé (append-only : jamais de ligne écrasée). */
async function currentEntry(key: DictionaryKey) {
  return prisma.dictionaryEntry.findFirst({
    where: { key },
    orderBy: { version: "desc" },
  });
}

/**
 * GET /dictionary/:key — { key, data, version }. Renvoie la dernière version.
 * Lecture ouverte à tout utilisateur authentifié (superviseurs en ont besoin
 * pour remplir les fiches), écriture réservée à l'admin (cf. ci-dessous).
 */
dictionaryRouter.get("/:key", async (req, res) => {
  const key = keyParam(req.params.key);
  if (!key) return res.status(404).json({ error: "unknown_dictionary_key" });

  const entry = await currentEntry(key);
  if (!entry) {
    // Jamais censé arriver après le seed, mais on répond quand même avec les
    // valeurs par défaut plutôt qu'une 404 déroutante côté frontend.
    return res.json({ key, data: DICTIONARY_DEFAULTS[key], version: 0 });
  }
  res.json({ key: entry.key, data: entry.data, version: entry.version });
});

/**
 * GET /dictionary/:key/versions/:version — { key, data, version } d'une version
 * PRÉCISE et passée. Résout la limite documentée (D12) : une fiche soumise
 * référence un numéro de version (Submission.modelVersion) ; cet endpoint permet
 * de retrouver le contenu exact du dictionnaire à ce moment-là, pas seulement le
 * numéro — reconstruction fidèle d'une ancienne définition.
 */
dictionaryRouter.get("/:key/versions/:version", async (req, res) => {
  const key = keyParam(req.params.key);
  if (!key) return res.status(404).json({ error: "unknown_dictionary_key" });
  const version = Number(req.params.version);
  if (!Number.isInteger(version))
    return res.status(400).json({ error: "invalid_version" });

  const entry = await prisma.dictionaryEntry.findUnique({
    where: { key_version: { key, version } },
  });
  if (!entry) return res.status(404).json({ error: "version_not_found" });
  res.json({ key: entry.key, data: entry.data, version: entry.version });
});

/**
 * PUT /dictionary/:key — { data } -> { key, data, version }.
 * INSÈRE une nouvelle version (jamais d'écrasement — voir le commentaire du
 * modèle dans schema.prisma) — miroir de saveFamilies()/saveFicheCatalog()/
 * saveBuildingCategories() côté frontend. Une fiche déjà soumise référence son
 * propre modelVersion : elle n'est donc jamais affectée rétroactivement par
 * cette écriture, et son contenu exact reste consultable via l'endpoint
 * "versions/:version" ci-dessus.
 */
dictionaryRouter.put("/:key", requireRole("admin"), async (req, res) => {
  const key = keyParam(req.params.key);
  if (!key) return res.status(404).json({ error: "unknown_dictionary_key" });
  if (!("data" in req.body))
    return res.status(400).json({ error: "missing_data" });

  const previous = await currentEntry(key);
  const entry = await prisma.dictionaryEntry.create({
    data: { key, data: req.body.data, version: (previous?.version ?? 0) + 1 },
  });
  res.json({ key: entry.key, data: entry.data, version: entry.version });
});

/**
 * POST /dictionary/:key/reset — revient aux valeurs par défaut (insère aussi
 * une nouvelle version, par traçabilité) — miroir de resetFamilies() etc.
 */
dictionaryRouter.post("/:key/reset", requireRole("admin"), async (req, res) => {
  const key = keyParam(req.params.key);
  if (!key) return res.status(404).json({ error: "unknown_dictionary_key" });

  const previous = await currentEntry(key);
  const entry = await prisma.dictionaryEntry.create({
    data: {
      key,
      data: DICTIONARY_DEFAULTS[key],
      version: (previous?.version ?? 0) + 1,
    },
  });
  res.json({ key: entry.key, data: entry.data, version: entry.version });
});
