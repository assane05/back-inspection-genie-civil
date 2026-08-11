/**
 * Valeurs par défaut des 3 dictionnaires — extraites telles quelles de
 * src/lib/{inspection-checklist,fiche-catalog,building-checklist}.ts côté
 * frontend (mêmes id/label/segments/items). Utilisées pour :
 *  - le seed initial de la base (prisma/seed.ts) ;
 *  - la réinitialisation admin ("Réinitialiser aux valeurs par défaut",
 *    POST /dictionary/:key/reset) — équivalent serveur de
 *    resetFamilies()/resetFicheCatalog()/resetBuildingCategories() côté
 *    frontend (src/lib/dictionary-store.ts).
 */
import families from "./families.json";
import ficheCatalog from "./fiche-catalog.json";
import buildingCategories from "./building-categories.json";

export const DICTIONARY_KEYS = ["families", "fiche-catalog", "building-categories"] as const;
export type DictionaryKey = (typeof DICTIONARY_KEYS)[number];

export function isDictionaryKey(key: string): key is DictionaryKey {
  return (DICTIONARY_KEYS as readonly string[]).includes(key);
}

export const DICTIONARY_DEFAULTS: Record<DictionaryKey, unknown> = {
  families,
  "fiche-catalog": ficheCatalog,
  "building-categories": buildingCategories,
};
