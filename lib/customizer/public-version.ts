export type CustomizerPublicVersion = {
  major: number;
  revision: number;
};

export type CustomizerUpdateType = "minor" | "major";

function nonNegativeInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export function normalizeCustomizerVersion(value: Partial<CustomizerPublicVersion> | null | undefined): CustomizerPublicVersion {
  return {
    major: Math.max(1, nonNegativeInteger(value?.major, 1)),
    revision: nonNegativeInteger(value?.revision, 0),
  };
}

export function formatCustomizerVersion(value: CustomizerPublicVersion): string {
  const version = normalizeCustomizerVersion(value);
  return version.revision === 0
    ? String(version.major)
    : `${version.major}.${String(version.revision).padStart(3, "0")}`;
}

export function nextCustomizerVersion(
  current: CustomizerPublicVersion,
  updateType: CustomizerUpdateType,
): CustomizerPublicVersion {
  const version = normalizeCustomizerVersion(current);
  return updateType === "major"
    ? { major: version.major + 1, revision: 0 }
    : { major: version.major, revision: version.revision + 1 };
}
