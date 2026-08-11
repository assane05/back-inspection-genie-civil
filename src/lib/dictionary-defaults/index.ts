import families from "./families.json";
import ficheCatalog from "./fiche-catalog.json";
import buildingCategories from "./building-categories.json";

export const DICTIONARY_KEYS = [
  "families",
  "fiche-catalog",
  "building-categories",
] as const;
export type DictionaryKey = (typeof DICTIONARY_KEYS)[number];

export function isDictionaryKey(key: string): key is DictionaryKey {
  return (DICTIONARY_KEYS as readonly string[]).includes(key);
}

export const DICTIONARY_DEFAULTS: Record<DictionaryKey, unknown> = {
  families,
  "fiche-catalog": ficheCatalog,
  "building-categories": buildingCategories,
};
