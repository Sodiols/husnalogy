/**
 * Request bodies read with a HARD byte limit.
 *
 * `request.json()` and `request.formData()` buffer the whole body before any
 * application check runs, and a `Content-Length` pre-check is bypassed by a
 * chunked request that simply omits the header. These helpers stream the body
 * and abort as soon as the limit is crossed, so an oversized request costs at
 * most `maxBytes` of memory regardless of what headers it carries.
 */

export class BodyTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes.`);
    this.name = "BodyTooLargeError";
  }
}

export class InvalidJsonError extends Error {
  constructor() {
    super("Request body is not valid JSON.");
    this.name = "InvalidJsonError";
  }
}

export async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0 || length > maxBytes) throw new BodyTooLargeError(maxBytes);
  }
  if (!request.body) return new Uint8Array(new ArrayBuffer(0));

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const body = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Parse a JSON body of at most `maxBytes`. Requires a JSON content type. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("application/json")) throw new InvalidJsonError();
  const bytes = await readBodyBytes(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InvalidJsonError();
  }
}

/** Parse a multipart/form-data body of at most `maxBytes`. */
export async function readFormDataBody(request: Request, maxBytes: number): Promise<FormData> {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) throw new InvalidJsonError();
  const bytes = await readBodyBytes(request, maxBytes);
  return new Response(bytes, { headers: { "content-type": type } }).formData();
}

/** Standard responses for the two failure modes. */
export function bodyErrorResponse(error: unknown): Response | null {
  if (error instanceof BodyTooLargeError) {
    return Response.json({ ok: false, error: "Request is too large." }, { status: 413 });
  }
  if (error instanceof InvalidJsonError) {
    return Response.json({ ok: false, error: "The request body is invalid." }, { status: 400 });
  }
  return null;
}
