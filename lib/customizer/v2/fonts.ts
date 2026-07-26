// Husnalogy controlled font registry (spec §10).
//
// Only fonts with server font files (public/fonts/*.ttf) render identically in
// the browser AND in server preview/print rendering — those are the only fonts
// allowed in production templates. System fonts remain listed for legacy
// templates but are flagged serverRenderable: false, which preflight reports.

export type FontWeightEntry = {
  weight: string; // "400" | "500" | ...
  style: "normal" | "italic";
  file: string; // path under public/, e.g. "fonts/Inter-400.ttf"
  browserUrl: string;
  enabledForAdmin: boolean;
  enabledForCustomer: boolean;
  licenseReference: string;
};

export type FontRegistryEntry = {
  id: string;
  displayName: string;
  cssFamily: string;
  cssStack: string;
  files: FontWeightEntry[];
  supportedWeights: string[];
  supportedStyles: Array<"normal" | "italic">;
  customerAvailable: boolean;
  adminAvailable: boolean;
  serverRenderable: boolean;
  license: string;
  licenseReference: string;
  fallbackFontId?: string;
  fallback: string; // css generic family
};

function localFile(
  file: string,
  weight: string,
  style: "normal" | "italic",
  licenseReference: string,
): FontWeightEntry {
  return {
    file,
    browserUrl: `/${file.replace(/\\/g, "/")}`,
    weight,
    style,
    enabledForAdmin: true,
    enabledForCustomer: true,
    licenseReference,
  };
}

const OFL_REFERENCE = "public/fonts/README.md";

export const FONT_REGISTRY_VERSION = "2026.07.14.1";

export const FONT_REGISTRY: FontRegistryEntry[] = [
  {
    id: "cormorant-garamond",
    displayName: "Cormorant Garamond",
    cssFamily: "Cormorant Garamond",
    cssStack: `"Cormorant Garamond", serif`,
    files: [
      localFile("fonts/CormorantGaramond-400.ttf", "400", "normal", OFL_REFERENCE),
      localFile("fonts/CormorantGaramond-400-italic.ttf", "400", "italic", OFL_REFERENCE),
      localFile("fonts/CormorantGaramond-500.ttf", "500", "normal", OFL_REFERENCE),
      localFile("fonts/CormorantGaramond-600.ttf", "600", "normal", OFL_REFERENCE),
      localFile("fonts/CormorantGaramond-700.ttf", "700", "normal", OFL_REFERENCE),
    ],
    supportedWeights: ["400", "500", "600", "700"],
    supportedStyles: ["normal", "italic"],
    customerAvailable: true,
    adminAvailable: true,
    serverRenderable: true,
    license: "SIL Open Font License 1.1 (Google Fonts)",
    licenseReference: OFL_REFERENCE,
    fallback: "serif",
  },
  {
    id: "inter",
    displayName: "Inter",
    cssFamily: "Inter",
    cssStack: `"Inter", sans-serif`,
    files: [
      localFile("fonts/Inter-400.ttf", "400", "normal", OFL_REFERENCE),
      localFile("fonts/Inter-400-italic.ttf", "400", "italic", OFL_REFERENCE),
      localFile("fonts/Inter-500.ttf", "500", "normal", OFL_REFERENCE),
      localFile("fonts/Inter-600.ttf", "600", "normal", OFL_REFERENCE),
      localFile("fonts/Inter-700.ttf", "700", "normal", OFL_REFERENCE),
    ],
    supportedWeights: ["400", "500", "600", "700"],
    supportedStyles: ["normal", "italic"],
    customerAvailable: true,
    adminAvailable: true,
    serverRenderable: true,
    license: "SIL Open Font License 1.1 (Google Fonts)",
    licenseReference: OFL_REFERENCE,
    fallbackFontId: "cormorant-garamond",
    fallback: "sans-serif",
  },
  // Legacy system fonts — kept so old templates still open, but they cannot be
  // reproduced identically by the server renderer. Preflight flags their use.
  {
    id: "georgia",
    displayName: "Georgia",
    cssFamily: "Georgia",
    cssStack: `Georgia, serif`,
    files: [],
    supportedWeights: ["400", "700"],
    supportedStyles: ["normal", "italic"],
    customerAvailable: false,
    adminAvailable: true,
    serverRenderable: false,
    license: "System font",
    licenseReference: "Operating system font; legacy compatibility only",
    fallbackFontId: "cormorant-garamond",
    fallback: "serif",
  },
  {
    id: "times-new-roman",
    displayName: "Times New Roman",
    cssFamily: "Times New Roman",
    cssStack: `"Times New Roman", serif`,
    files: [],
    supportedWeights: ["400", "700"],
    supportedStyles: ["normal", "italic"],
    customerAvailable: false,
    adminAvailable: true,
    serverRenderable: false,
    license: "System font",
    licenseReference: "Operating system font; legacy compatibility only",
    fallbackFontId: "cormorant-garamond",
    fallback: "serif",
  },
  {
    id: "arial",
    displayName: "Arial",
    cssFamily: "Arial",
    cssStack: `Arial, sans-serif`,
    files: [],
    supportedWeights: ["400", "700"],
    supportedStyles: ["normal", "italic"],
    customerAvailable: false,
    adminAvailable: true,
    serverRenderable: false,
    license: "System font",
    licenseReference: "Operating system font; legacy compatibility only",
    fallbackFontId: "inter",
    fallback: "sans-serif",
  },
  {
    id: "courier-new",
    displayName: "Courier New",
    cssFamily: "Courier New",
    cssStack: `"Courier New", monospace`,
    files: [],
    supportedWeights: ["400", "700"],
    supportedStyles: ["normal", "italic"],
    customerAvailable: false,
    adminAvailable: true,
    serverRenderable: false,
    license: "System font",
    licenseReference: "Operating system font; legacy compatibility only",
    fallbackFontId: "inter",
    fallback: "monospace",
  },
];

const byFamily = new Map(FONT_REGISTRY.map((f) => [f.cssFamily.toLowerCase(), f]));
const byId = new Map(FONT_REGISTRY.map((f) => [f.id, f]));

export function getFontByFamily(family: string | undefined | null): FontRegistryEntry | null {
  if (!family) return null;
  return byFamily.get(String(family).trim().toLowerCase()) || null;
}

export function getFontById(id: string): FontRegistryEntry | null {
  return byId.get(id) || null;
}

export function isServerRenderableFont(family: string): boolean {
  return Boolean(getFontByFamily(family)?.serverRenderable);
}

export function listFonts(options: { customerOnly?: boolean; adminOnly?: boolean } = {}): FontRegistryEntry[] {
  return FONT_REGISTRY.filter((font) => {
    if (options.customerOnly && !font.customerAvailable) return false;
    if (options.adminOnly && !font.adminAvailable) return false;
    return true;
  });
}

// Resolve the closest registered font file for a requested weight/style —
// exact match first, then same style nearest weight, then the 400/normal file.
export function resolveFontFile(
  family: string,
  weight: string | number = "400",
  style: "normal" | "italic" = "normal",
): FontWeightEntry | null {
  const font = getFontByFamily(family);
  if (!font || !font.files.length) return null;
  const w = String(weight || "400");
  const exact = font.files.find((f) => f.weight === w && f.style === style);
  if (exact) return exact;
  const sameStyle = font.files
    .filter((f) => f.style === style)
    .sort((a, b) => Math.abs(Number(a.weight) - Number(w)) - Math.abs(Number(b.weight) - Number(w)));
  if (sameStyle.length) return sameStyle[0];
  return font.files.find((f) => f.weight === "400" && f.style === "normal") || font.files[0];
}

// Every distinct font file a document's text layers depend on. Used by the
// render pipeline to load exactly the fonts a job needs and to fail clearly
// when one is missing (spec §10: never silently substitute in production).
export function collectFontDependencies(
  textStyles: Array<{ fontFamily?: string; fontWeight?: string; fontStyle?: string }>,
): { files: FontWeightEntry[]; missingFamilies: string[] } {
  const files = new Map<string, FontWeightEntry>();
  const missing = new Set<string>();
  for (const style of textStyles) {
    const family = style.fontFamily || "Cormorant Garamond";
    const entry = resolveFontFile(family, style.fontWeight || "400", style.fontStyle === "italic" ? "italic" : "normal");
    if (entry) files.set(entry.file, entry);
    else missing.add(family);
  }
  return { files: [...files.values()], missingFamilies: [...missing] };
}
