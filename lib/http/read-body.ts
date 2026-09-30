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

export async function readBodyBytes(request: Pick<Request, "headers" | "body">, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
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

export type JsonObjectResult = { body: Record<string, unknown>; response: Response | null };

/**
 * Read a JSON OBJECT body of at most `maxBytes` for an ordinary API route.
 *
 *   const { body, response } = await readJsonObject(request, 16 * 1024);
 *   if (response) return response;
 *
 * Oversized → 413 (even without Content-Length). Malformed JSON or a
 * non-object value → 400. An empty body is `{}`. The Content-Type is not
 * required here (some internal callers omit it); routes that must refuse
 * cross-site "simple" requests call `rejectCrossSiteRequest` as well.
 */
export async function readJsonObject(request: Request, maxBytes: number): Promise<JsonObjectResult> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readBodyBytes(request, maxBytes);
  } catch (error) {
    const response = bodyErrorResponse(error);
    if (response) return { body: {}, response };
    throw error;
  }
  if (!bytes.byteLength) return { body: {}, response: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { body: {}, response: Response.json({ ok: false, error: "The request body is invalid." }, { status: 400 }) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { body: {}, response: Response.json({ ok: false, error: "The request body must be a JSON object." }, { status: 400 }) };
  }
  return { body: parsed as Record<string, unknown>, response: null };
}

export type FormDataResult = { form: FormData | null; response: Response | null };

/** Read a multipart body of at most `maxBytes` (413 when larger, 400 when malformed). */
export async function readFormData(request: Request, maxBytes: number): Promise<FormDataResult> {
  try {
    return { form: await readFormDataBody(request, maxBytes), response: null };
  } catch (error) {
    const response = bodyErrorResponse(error);
    if (response && response.status === 413) return { form: null, response };
    return { form: null, response: Response.json({ ok: false, error: "The upload could not be read." }, { status: 400 }) };
  }
}
