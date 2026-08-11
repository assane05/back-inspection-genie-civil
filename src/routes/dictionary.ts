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

async function currentEntry(key: DictionaryKey) {
  return prisma.dictionaryEntry.findFirst({
    where: { key },
    orderBy: { version: "desc" },
  });
}

dictionaryRouter.get("/:key", async (req, res) => {
  const key = keyParam(req.params.key);
  if (!key) return res.status(404).json({ error: "unknown_dictionary_key" });

  const entry = await currentEntry(key);
  if (!entry) {
    return res.json({ key, data: DICTIONARY_DEFAULTS[key], version: 0 });
  }
  res.json({ key: entry.key, data: entry.data, version: entry.version });
});

// versions
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

// role admin
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
  revient aux valeurs par défaut, miroir de resetFamilies().
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
