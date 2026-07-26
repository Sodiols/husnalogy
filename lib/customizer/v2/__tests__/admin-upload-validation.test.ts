import { describe, expect, it } from "vitest";
import { sanitizeSvg, sniffImageType } from "../uploads";

describe("administrator asset upload validation", () => {
  it("detects supported formats by bytes rather than browser MIME", () => {
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
    expect(sniffImageType(png, true)).toEqual({ ok: true, mime: "image/png" });
    expect(sniffImageType(Buffer.from("not an image at all"), true).ok).toBe(false);
  });

  it("rejects executable, external, imported, and nested SVG content", () => {
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/a.png" /></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://evil.test/a.css";</style></svg>').ok).toBe(false);
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,AAAA" /></svg>').ok).toBe(false);
  });

  it("keeps safe local SVG references and removes XML declaration surfaces", () => {
    const result = sanitizeSvg('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" /></defs><rect fill="url(#g)" /></svg>');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.svg).toContain("url(#g)");
      expect(result.svg).not.toContain("<?xml");
    }
  });
});
