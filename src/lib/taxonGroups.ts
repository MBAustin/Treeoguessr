// Organism-type filters for the round settings, as three top-level categories
// (kingdoms) each with nested taxonomic subgroups plus an "Other" catch-all so
// every species is selectable. These are taxa (which iNat filters on via
// taxon_id / without_taxon_id), not growth forms — so e.g. "trees" aren't
// separable from other broadleaf plants. All taxon ids verified to return local
// species near a populated area.

export interface Subgroup {
  key: string;
  emoji: string;
  label: string;
  /** Taxon ids this subgroup includes. Omitted for the "Other" catch-all, which
   *  is defined as its category's parent minus all the named subgroups. */
  taxonIds?: number[];
  other?: true;
}

export interface Category {
  key: string;
  emoji: string;
  label: string;
  /** iNat kingdom taxon id — the universe the subgroups partition. */
  parentId: number;
  subgroups: Subgroup[];
}

export const CATEGORIES: Category[] = [
  {
    key: "plants",
    emoji: "🌿",
    label: "Plants",
    parentId: 47126, // Plantae
    subgroups: [
      { key: "plants_broadleaf", emoji: "🌼", label: "Broadleaf plants", taxonIds: [47124] }, // Magnoliopsida
      { key: "plants_monocots", emoji: "🌾", label: "Grasses & monocots", taxonIds: [47163] }, // Liliopsida
      { key: "plants_conifers", emoji: "🌲", label: "Conifers", taxonIds: [136329] }, // Pinopsida
      { key: "plants_ferns", emoji: "🌿", label: "Ferns", taxonIds: [121943] }, // Polypodiopsida
      { key: "plants_mosses", emoji: "🍃", label: "Mosses", taxonIds: [311249] }, // Bryophyta
      { key: "plants_liverworts", emoji: "🌱", label: "Liverworts", taxonIds: [64615] }, // Marchantiophyta
      { key: "plants_other", emoji: "➕", label: "Other plants", other: true },
    ],
  },
  {
    key: "animals",
    emoji: "🐦",
    label: "Animals",
    parentId: 1, // Animalia
    subgroups: [
      { key: "animals_birds", emoji: "🐦", label: "Birds", taxonIds: [3] }, // Aves
      { key: "animals_mammals", emoji: "🦊", label: "Mammals", taxonIds: [40151] }, // Mammalia
      { key: "animals_insects", emoji: "🐝", label: "Insects", taxonIds: [47158] }, // Insecta
      { key: "animals_arachnids", emoji: "🕷️", label: "Spiders & arachnids", taxonIds: [47119] }, // Arachnida
      { key: "animals_herps", emoji: "🦎", label: "Reptiles & amphibians", taxonIds: [26036, 20978] }, // Reptilia, Amphibia
      { key: "animals_fishes", emoji: "🐟", label: "Fishes", taxonIds: [47178] }, // Actinopterygii
      { key: "animals_mollusks", emoji: "🐌", label: "Mollusks", taxonIds: [47115] }, // Mollusca
      { key: "animals_other", emoji: "➕", label: "Other animals", other: true },
    ],
  },
  {
    key: "fungi",
    emoji: "🍄",
    label: "Fungi",
    parentId: 47170, // Fungi
    subgroups: [
      { key: "fungi_mushrooms", emoji: "🍄", label: "Mushrooms", taxonIds: [47169] }, // Basidiomycota
      { key: "fungi_sac", emoji: "🟤", label: "Sac fungi & lichens", taxonIds: [48250] }, // Ascomycota
      { key: "fungi_other", emoji: "➕", label: "Other fungi", other: true },
    ],
  },
];

/** Default selection: all Plants subgroups; Animals and Fungi start off. */
export const DEFAULT_KEYS: string[] = CATEGORIES[0].subgroups.map((s) => s.key);

export interface TaxonFilter {
  include: number[];
  exclude: number[];
}

/**
 * Turn selected subgroup keys into a single iNat filter (taxon_id includes +
 * without_taxon_id excludes). For a category with "Other" selected we include
 * the kingdom and exclude only its named subgroups that *aren't* selected
 * (parent − unselected = selected ∪ other); otherwise we include the selected
 * named subgroups' taxa. Empty selection falls back to Plants.
 */
export function groupsToTaxonFilter(selectedKeys: string[]): TaxonFilter {
  const selected = new Set(selectedKeys);
  const include: number[] = [];
  const exclude: number[] = [];

  for (const cat of CATEGORIES) {
    const named = cat.subgroups.filter((s) => !s.other);
    const other = cat.subgroups.find((s) => s.other);
    const otherOn = other != null && selected.has(other.key);
    const selectedNamed = named.filter((s) => selected.has(s.key));

    if (otherOn) {
      include.push(cat.parentId);
      for (const s of named) {
        if (!selected.has(s.key)) exclude.push(...(s.taxonIds ?? []));
      }
    } else {
      for (const s of selectedNamed) include.push(...(s.taxonIds ?? []));
    }
  }

  if (include.length === 0) return { include: [CATEGORIES[0].parentId], exclude: [] };
  return { include, exclude };
}

/** The default filter (all plants) — used by VS and as a fallback. */
export const DEFAULT_FILTER: TaxonFilter = groupsToTaxonFilter(DEFAULT_KEYS);

