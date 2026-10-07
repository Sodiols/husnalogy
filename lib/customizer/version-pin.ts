/**
 * A saved customization belongs to the EXACT immutable template version it was
 * made on. Client-safe: the customer editor uses this before it opens a saved
 * design, the server page decides which version to load (lib/customizer/versions.ts).
 */

export const EXACT_VERSION_UNAVAILABLE_MESSAGE =
  "We could not load the exact version of your saved design. Your design has not been changed. Please retry.";

type SavedDesignIdentity = {
  templateId?: unknown;
  templateVersion?: unknown;
  renderData?: { templateVersion?: unknown } | null;
};

type LoadedTemplate = { id?: unknown; version?: unknown } | null | undefined;

/**
 * Whether `saved` may be opened on `template` without changing the version it
 * belongs to. A design that records no version predates versioning and opens
 * on whatever was served; every other design needs its own template id and
 * version, exactly.
 */
export function savedDesignMatchesTemplate(saved: SavedDesignIdentity | null | undefined, template: LoadedTemplate): boolean {
  if (!saved) return false;
  const savedVersion = Number(saved.templateVersion || saved.renderData?.templateVersion || 0);
  if (!savedVersion) return true;
  if (savedVersion !== Number(template?.version || 0)) return false;
  const savedTemplateId = String(saved.templateId || "");
  const templateId = String(template?.id || "");
  return !savedTemplateId || !templateId || savedTemplateId === templateId;
}
