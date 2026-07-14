import type { RenderJobType } from "./types";

export const CUSTOMIZER_FEATURE_FLAGS = [
  "customizer_v2",
  "customizer_v2_grids",
  "customizer_v2_groups",
  "customizer_v2_mockups",
  "customizer_v2_perspective_mockups",
  "customizer_v2_server_rendering",
  "customizer_v2_print_pdf",
] as const;

export type CustomizerFeatureFlag = (typeof CUSTOMIZER_FEATURE_FLAGS)[number];

export function isCustomizerFeatureEnabled(source: any, flag: CustomizerFeatureFlag): boolean {
  const flags = source?.featureFlags || source?.settings?.featureFlags || {};
  return Boolean(flags?.[flag]);
}

export function getDisabledRenderFeature(
  source: any,
  jobType: RenderJobType,
): CustomizerFeatureFlag | null {
  const flags = source?.featureFlags || source?.settings?.featureFlags || {};
  if (Object.prototype.hasOwnProperty.call(flags, "customizer_v2") && !isCustomizerFeatureEnabled(source, "customizer_v2")) {
    return "customizer_v2";
  }
  if (!isCustomizerFeatureEnabled(source, "customizer_v2_server_rendering")) {
    return "customizer_v2_server_rendering";
  }
  if (jobType === "mockup" && !isCustomizerFeatureEnabled(source, "customizer_v2_mockups")) {
    return "customizer_v2_mockups";
  }
  const mockups = source?.mockupTemplates || source?.settings?.mockupTemplates || [];
  const usesPerspective = mockups.some((mockup: any) => mockup?.views?.some((view: any) => view?.artworkAreas?.some((area: any) => area?.warpType === "perspective")));
  if (jobType === "mockup" && usesPerspective && !isCustomizerFeatureEnabled(source, "customizer_v2_perspective_mockups")) {
    return "customizer_v2_perspective_mockups";
  }
  if (jobType === "print_pdf" && !isCustomizerFeatureEnabled(source, "customizer_v2_print_pdf")) {
    return "customizer_v2_print_pdf";
  }
  return null;
}

export function withCustomizerFeatureFlag(template: any, flag: CustomizerFeatureFlag, enabled: boolean): any {
  return {
    ...template,
    settings: {
      ...(template?.settings || {}),
      featureFlags: { ...(template?.settings?.featureFlags || {}), [flag]: enabled },
    },
  };
}
