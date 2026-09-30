import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFormData, readJsonObject } from "@/lib/http/read-body";

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? routeFiles(path) : /\.(ts|tsx|js)$/.test(entry) ? [path] : [];
  });
}

const stream = (bytes: number) =>
  new ReadableStream({
    start(controller) {
      for (let sent = 0; sent < bytes; sent += 16_384) controller.enqueue(new Uint8Array(Math.min(16_384, bytes - sent)));
      controller.close();
    },
  });

describe("no route reads an unbounded body", () => {
  it("every request body in app/ goes through the bounded readers", () => {
    const offenders = routeFiles(join(process.cwd(), "app")).filter((file) =>
      /request\.(json|text|formData|arrayBuffer|blob)\(\)/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the proxy does not read bodies either", () => {
    expect(readFileSync(join(process.cwd(), "proxy.js"), "utf8")).not.toMatch(/request\.(json|text|formData)\(\)/);
  });
});

describe("readJsonObject", () => {
  const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request("https://husnalogy.com/api/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);

  it("rejects an oversized body declared by Content-Length before reading it", async () => {
    const { response } = await readJsonObject(post("{}", { "content-length": "50000" }), 1024);
    expect(response?.status).toBe(413);
  });

  it("rejects an oversized streamed body with no Content-Length", async () => {
    const { response } = await readJsonObject(post(stream(300_000)), 24 * 1024);
    expect(response?.status).toBe(413);
  });

  it("rejects a Content-Length that lies (small header, large body)", async () => {
    const { response } = await readJsonObject(post(stream(300_000), { "content-length": "10" }), 24 * 1024);
    expect(response?.status).toBe(413);
  });

  it("rejects invalid JSON and non-object JSON; accepts an empty body as {}", async () => {
    expect((await readJsonObject(post("{nope"), 1024)).response?.status).toBe(400);
    expect((await readJsonObject(post("[1,2]"), 1024)).response?.status).toBe(400);
    expect((await readJsonObject(post('"x"'), 1024)).response?.status).toBe(400);
    expect(await readJsonObject(post(null), 1024)).toEqual({ body: {}, response: null });
    expect(await readJsonObject(post('{"a":1}'), 1024)).toEqual({ body: { a: 1 }, response: null });
  });

  it("bounds multipart uploads the same way", async () => {
    const { response } = await readFormData(post(stream(200_000), { "content-type": "multipart/form-data; boundary=x" }), 64 * 1024);
    expect(response?.status).toBe(413);
  });
});
