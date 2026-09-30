/** Supports both historical flat files and v1 output-type/page groups. */
export async function signProductionOutputLinks(files: Record<string, any>, ready: Array<{ bucket: string; path: string; checksum: string }>, sign: (bucket: string, path: string) => Promise<string>): Promise<Record<string, any>> {
  const result: Record<string, any> = {};
  for (const [key, file] of Object.entries(files || {})) {
    if (!file || typeof file !== "object") continue;
    if (file.bucket && file.path) {
      if (!ready.some((output) => output.bucket === file.bucket && output.path === file.path && output.checksum === file.checksum)) continue;
      result[key] = { ...file, signedUrl: await sign(file.bucket, file.path) };
    } else {
      const group = await signProductionOutputLinks(file, ready, sign);
      if (Object.keys(group).length) result[key] = group;
    }
  }
  return result;
}
