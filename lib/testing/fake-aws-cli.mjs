#!/usr/bin/env node
/**
 * TEST DOUBLE of the AWS CLI subset the backup destination uses
 * (scripts/backup/lib/destination.mjs): `s3 cp` (file↔s3, --recursive),
 * `s3 rm --recursive`, `s3api list-objects-v2`. Objects live under
 * FAKE_S3_ROOT/<bucket>/<key>. It proves the backup tool's upload,
 * verification and failure handling — not AWS or any real provider.
 *
 * Fault injection (FAKE_S3_FAIL):
 *   cp       every upload fails (exit 1)
 *   partial  a recursive upload silently skips its last file and exits 0
 *   list     listing fails
 *   auth     every command fails like rejected/expired credentials
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const args = process.argv.slice(2).filter((arg, index, all) => !(arg === "--output" || all[index - 1] === "--output" || arg === "--endpoint-url" || all[index - 1] === "--endpoint-url" || arg === "--only-show-errors"));
const root = process.env.FAKE_S3_ROOT;
const fail = process.env.FAKE_S3_FAIL || "";
const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
if (!root) die("FAKE_S3_ROOT is not set");
if (fail === "auth") die("An error occurred (InvalidAccessKeyId) when calling the operation: The AWS Access Key Id you provided does not exist in our records.");

const parseS3 = (url) => {
  const match = /^s3:\/\/([^/]+)\/?(.*)$/.exec(url);
  if (!match) die(`not an s3 url: ${url}`);
  return { bucket: match[1], key: match[2] };
};
const walk = (dir) => {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};

const [service, command, ...rest] = args;
if (service === "s3api" && command === "list-objects-v2") {
  if (fail === "list") die("An error occurred (ServiceUnavailable) when calling the ListObjectsV2 operation");
  const bucket = rest[rest.indexOf("--bucket") + 1];
  const prefix = rest.includes("--prefix") ? rest[rest.indexOf("--prefix") + 1] : "";
  const base = join(root, bucket);
  const contents = walk(base).map((full) => ({ Key: relative(base, full).split("\\").join("/"), Size: statSync(full).size })).filter((item) => item.Key.startsWith(prefix)).sort((a, b) => a.Key.localeCompare(b.Key));
  process.stdout.write(JSON.stringify(contents.length ? { Contents: contents } : {}));
} else if (service === "s3" && command === "cp") {
  const recursive = rest.includes("--recursive");
  const [from, to] = rest.filter((arg) => arg !== "--recursive");
  if (to.startsWith("s3://")) {
    if (fail === "cp") die("upload failed: An error occurred (InternalError) when calling the PutObject operation");
    const { bucket, key } = parseS3(to);
    const files = recursive ? walk(from).map((full) => ({ full, key: `${key.replace(/\/?$/, "/")}${relative(from, full).split("\\").join("/")}` })) : [{ full: from, key }];
    const upload = fail === "partial" && files.length > 1 ? files.slice(0, -1) : files;
    for (const file of upload) {
      const target = join(root, bucket, file.key);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(file.full, target);
    }
  } else {
    const { bucket, key } = parseS3(from);
    const base = join(root, bucket);
    if (recursive) {
      for (const full of walk(base).filter((path) => relative(base, path).split("\\").join("/").startsWith(key))) {
        const target = join(to, relative(join(base, key), full));
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(full, target);
      }
    } else {
      const source = join(base, key);
      if (!existsSync(source)) die("fatal error: An error occurred (404) when calling the HeadObject operation: Not Found");
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(source, to);
    }
  }
} else if (service === "s3" && command === "rm") {
  const { bucket, key } = parseS3(rest.find((arg) => arg.startsWith("s3://")));
  rmSync(join(root, bucket, key), { recursive: true, force: true });
} else {
  die(`fake aws: unsupported command ${args.join(" ")}`);
}
