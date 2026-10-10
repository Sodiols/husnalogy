/**
 * Font categories for the shared font selector (Customizer Point 4).
 *
 * Two sources, both durable — nothing is guessed at render time:
 *
 *  - Google's own catalog metadata decides Serif, Sans Serif and Hand Written
 *    (the Developer API's `serif`, `sans-serif` and `handwriting` categories).
 *  - Script and Retro are not Google categories. They are Husnalogy's own,
 *    maintained by hand in the curated lists below, version controlled with the
 *    code and reviewed like any other change.
 *
 * Formal scripts (Great Vibes, Allura, Pinyon Script…) are filed by Google as
 * "handwriting"; Husnalogy shows them under Script instead, so Hand Written is
 * left with the genuinely casual hands. A face may be both Script and Retro
 * (Yellowtail, Lobster): those tabs overlap on purpose.
 *
 * Favourites are not decided here: they live in the database
 * (`customizer_font_favourites`) and are passed in.
 */

export type FontCategoryId = "all" | "favourites" | "serif" | "sans-serif" | "script" | "retro" | "handwritten";

export const FONT_CATEGORY_TABS: ReadonlyArray<{ id: FontCategoryId; label: string }> = [
  { id: "all", label: "All Fonts" },
  { id: "favourites", label: "Favourite Fonts" },
  { id: "serif", label: "Serif" },
  { id: "sans-serif", label: "Sans Serif" },
  { id: "script", label: "Script" },
  { id: "retro", label: "Retro" },
  { id: "handwritten", label: "Hand Written" },
];

/**
 * Every genuine script face in the Google catalog: formal and calligraphic
 * scripts, brush and signature scripts, and the connected retro scripts Google
 * files as "display" (Lobster, Playball…). Casual print hands, markers and the
 * Playwrite / Edu teaching hands stay in Hand Written. Reviewed against the
 * live catalog on 2026-10-10.
 */
export const CURATED_SCRIPT_FONTS: readonly string[] = [
  "Aguafina Script",
  "Alex Brush",
  "Allison",
  "Allura",
  "Arizonia",
  "Babylonica",
  "Bad Script",
  "Ballet",
  "Beau Rivage",
  "Bilbo",
  "Bilbo Swash Caps",
  "Birthstone",
  "Birthstone Bounce",
  "Bonheur Royale",
  "Caramel",
  "Carattere",
  "Charm",
  "Charmonman",
  "Cherish",
  "Clicker Script",
  "Comforter",
  "Comforter Brush",
  "Condiment",
  "Cookie",
  "Corinthia",
  "Damion",
  "Dancing Script",
  "Devonshire",
  "Dr Sugiyama",
  "Dynalight",
  "Engagement",
  "Ephesis",
  "Estonia",
  "Euphoria Script",
  "Explora",
  "Felipa",
  "Festive",
  "Fleur De Leah",
  "Fuggles",
  "Grand Hotel",
  "Great Vibes",
  "Grey Qo",
  "Gwendolyn",
  "Herr Von Muellerhoff",
  "Hurricane",
  "Imperial Script",
  "Ingrid Darling",
  "Inspiration",
  "Island Moments",
  "Italianno",
  "Kaushan Script",
  "Kolker Brush",
  "Kristi",
  "Lavishly Yours",
  "League Script",
  "Leckerli One",
  "Licorice",
  "Lily Script One",
  "Lobster",
  "Lobster Two",
  "Love Light",
  "Lovers Quarrel",
  "Lugrasimo",
  "Luxurious Script",
  "Marck Script",
  "Mea Culpa",
  "Meddon",
  "Meie Script",
  "Meow Script",
  "Miss Fajardose",
  "Monsieur La Doulaise",
  "MonteCarlo",
  "Montez",
  "Moon Dance",
  "Mr Bedfort",
  "Mr Dafoe",
  "Mr De Haviland",
  "Mrs Saint Delafield",
  "Mrs Sheppards",
  "Ms Madi",
  "My Soul",
  "Niconne",
  "Norican",
  "Ole",
  "Oleo Script",
  "Oleo Script Swash Caps",
  "Pacifico",
  "Parisienne",
  "Passions Conflict",
  "Petemoss",
  "Petit Formal Script",
  "Pinyon Script",
  "Playball",
  "Praise",
  "Princess Sofia",
  "Quintessential",
  "Qwigley",
  "Qwitcher Grypen",
  "Redressed",
  "Rochester",
  "Rouge Script",
  "Ruthie",
  "Sacramento",
  "Sail",
  "Sassy Frass",
  "Satisfy",
  "Seaweed Script",
  "Send Flowers",
  "Shalimar",
  "Smooch",
  "Sofia",
  "Stalemate",
  "Style Script",
  "Tangerine",
  "The Nautigal",
  "Updock",
  "Vibes",
  "Vibur",
  "Vujahday Script",
  "Water Brush",
  "Waterfall",
  "Whisper",
  "WindSong",
  "Yellowtail",
  "Yesteryear",
];

/** Retro and vintage display faces. */
export const CURATED_RETRO_FONTS: readonly string[] = [
  "Abril Fatface",
  "Alfa Slab One",
  "Bevan",
  "Bowlby One SC",
  "Bungee",
  "Bungee Shade",
  "Chango",
  "Cherry Cream Soda",
  "Damion",
  "Fascinate",
  "Fascinate Inline",
  "Federo",
  "Fredericka the Great",
  "Graduate",
  "Grand Hotel",
  "Holtwood One SC",
  "Limelight",
  "Lobster",
  "Lobster Two",
  "Monoton",
  "Oleo Script",
  "Pacifico",
  "Playball",
  "Poiret One",
  "Righteous",
  "Rye",
  "Sancreek",
  "Shrikhand",
  "Special Elite",
  "Ultra",
  "Vast Shadow",
  "Yellowtail",
];

const key = (family: string) => String(family || "").trim().toLowerCase();
const SCRIPT = new Set(CURATED_SCRIPT_FONTS.map(key));
const RETRO = new Set(CURATED_RETRO_FONTS.map(key));

type Classifiable = { family: string; category: string };

/** The Husnalogy categories one family belongs to (never "all" or "favourites"). */
export function classifyFontFamily(entry: Classifiable): FontCategoryId[] {
  const family = key(entry.family);
  const google = key(entry.category);
  const categories: FontCategoryId[] = [];
  if (google === "serif") categories.push("serif");
  if (google === "sans-serif") categories.push("sans-serif");
  if (SCRIPT.has(family)) categories.push("script");
  else if (google === "handwriting") categories.push("handwritten");
  if (RETRO.has(family)) categories.push("retro");
  return categories;
}

/**
 * Classify a whole catalog ONCE. The selector re-renders on every keystroke of
 * a search; classification belongs to the catalog, not to the render.
 */
export function buildFontCategoryIndex(families: readonly Classifiable[]): Map<string, FontCategoryId[]> {
  return new Map(families.map((entry) => [key(entry.family), classifyFontFamily(entry)]));
}

/**
 * The families a tab shows. `families` must already be the fonts this design
 * PERMITS (the template allowlist is applied before this), so no category —
 * favourites included — can ever offer a font the template does not allow.
 */
export function filterFamiliesByCategory<T extends Classifiable>(
  families: readonly T[],
  category: FontCategoryId,
  index: Map<string, FontCategoryId[]>,
  favourites: ReadonlySet<string>,
): T[] {
  if (category === "all") return families.slice();
  if (category === "favourites") return families.filter((entry) => favourites.has(key(entry.family)));
  return families.filter((entry) => (index.get(key(entry.family)) || classifyFontFamily(entry)).includes(category));
}

/** Normalised lookup key for favourites, shared with the server. */
export const fontFamilyKey = key;
