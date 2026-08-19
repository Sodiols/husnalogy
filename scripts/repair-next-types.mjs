import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// Next.js regenerates `.next/types` (build) and `.next/dev/types` (dev server).
// An interrupted or non-truncating write can leave a short payload with the tail
// of the previous, longer revision still attached. tsconfig pulls both folders
// into the program, so the wreckage surfaces as TS1109 "Expression expected"
// inside generated files that no one edits. These artifacts are disposable:
// detect the damaged ones, restore them from the healthy sibling folder when
// possible, otherwise drop them so Next writes them again.

const root = process.cwd();
const typeDirs = [".next/types", ".next/dev/types"];
const nextEnvPath = join(root, "next-env.d.ts");

const isParsable = (absolute) => {
  const source = ts.createSourceFile(absolute, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, false);
  return (source.parseDiagnostics ?? []).length === 0;
};

const files = new Map();
for (const dir of typeDirs) {
  const absoluteDir = join(root, dir);
  if (!existsSync(absoluteDir)) continue;
  for (const entry of readdirSync(absoluteDir)) {
    if (!entry.endsWith(".ts")) continue;
    const absolute = join(absoluteDir, entry);
    files.set(`${dir}|${entry}`, { dir, entry, absolute, healthy: isParsable(absolute) });
  }
}

const healthyTwin = (entry, dir) =>
  [...files.values()].find((file) => file.entry === entry && file.dir !== dir && file.healthy);

const repaired = [];
const removed = [];
for (const file of files.values()) {
  if (file.healthy) continue;
  const twin = healthyTwin(file.entry, file.dir);
  if (twin) {
    copyFileSync(twin.absolute, file.absolute);
    file.healthy = true;
    repaired.push(`${file.dir}/${file.entry} (restored from ${twin.dir})`);
    continue;
  }
  rmSync(file.absolute, { force: true });
  files.delete(`${file.dir}|${file.entry}`);
  removed.push(`${file.dir}/${file.entry}`);
}

// next-env.d.ts imports whichever routes.d.ts the last Next command produced. If
// that file was just discarded, repoint it at a surviving copy so the failure is
// not simply traded for an unresolved import.
let repointed = null;
if (existsSync(nextEnvPath)) {
  const source = readFileSync(nextEnvPath, "utf8");
  const referenced = source.match(/import\s+"(\.\/\.next\/[^"]*routes\.d\.ts)"/);
  if (referenced && !existsSync(join(root, referenced[1]))) {
    const survivor = [...files.values()].find((file) => file.entry === "routes.d.ts" && file.healthy);
    if (survivor) {
      const replacement = `./${survivor.dir}/routes.d.ts`;
      writeFileSync(nextEnvPath, source.replace(referenced[1], replacement));
      repointed = replacement;
    }
  }
}

if (!repaired.length && !removed.length) {
  console.log(`Next generated types verified (${files.size} files).`);
} else {
  for (const item of repaired) console.log(`Repaired corrupt generated type file: ${item}`);
  for (const item of removed) console.log(`Removed corrupt generated type file: ${item}`);
  if (repointed) console.log(`Repointed next-env.d.ts at ${repointed}`);
  if (removed.length && !repointed) console.log("Run `npm run build` (or `next dev`) to regenerate the discarded files.");
}
