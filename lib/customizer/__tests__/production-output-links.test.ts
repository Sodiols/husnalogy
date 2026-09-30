import { describe, expect, it, vi } from "vitest";
import { signProductionOutputLinks } from "@/lib/customizer/server/production-output-links";

describe("staff manufacturing downloads", () => {
  const png = { bucket: "customizer-renders", path: "orders/o/png", checksum: "png" };
  const pdf = { bucket: "customizer-renders", path: "orders/o/pdf", checksum: "pdf" };
  it("signs every required PNG/PDF group and preserves old flat references", async () => {
    const sign = vi.fn(async (_bucket: string, path: string) => `signed:${path}`);
    expect(await signProductionOutputLinks({ print_png: { front: png }, print_pdf: { all: pdf } }, [png, pdf], sign)).toEqual({ print_png: { front: { ...png, signedUrl: "signed:orders/o/png" } }, print_pdf: { all: { ...pdf, signedUrl: "signed:orders/o/pdf" } } });
    expect(await signProductionOutputLinks({ front: png }, [png], sign)).toEqual({ front: { ...png, signedUrl: "signed:orders/o/png" } });
  });
  it("never signs invalidated, missing or checksum-mismatched output references", async () => {
    const sign = vi.fn(async () => "unsafe");
    expect(await signProductionOutputLinks({ print_png: { front: png }, print_pdf: { all: pdf } }, [{ ...png, checksum: "different" }], sign)).toEqual({});
    expect(sign).not.toHaveBeenCalled();
  });
});
