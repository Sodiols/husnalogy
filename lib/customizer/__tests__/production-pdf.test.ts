import { describe, expect, it } from "vitest";
import { PDFDocument, PDFDict, PDFName, StandardFonts } from "pdf-lib";
import { validateProductionPdf } from "@/lib/customizer/server/production-pdf";

async function source() {
  const document = await PDFDocument.create(); const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage().drawText("Approved production PDF", { font });
  return document;
}
describe("manual PDF production resources", () => {
  it("accepts readable PDFs with PDF-standard self-contained font resources", async () => {
    await expect(validateProductionPdf(Buffer.from(await (await source()).save()))).resolves.toBeUndefined();
  });
  it("rejects unembedded custom fonts instead of substituting workstation fonts", async () => {
    const document = await source();
    await document.flush();
    for (const [, object] of document.context.enumerateIndirectObjects()) if (object instanceof PDFDict && object.get(PDFName.of("Type"))?.toString() === "/Font") object.set(PDFName.of("BaseFont"), PDFName.of("UnembeddedMutableFamily"));
    await expect(validateProductionPdf(Buffer.from(await document.save()))).rejects.toThrow(/unembedded fonts/);
  });
  it("rejects corrupt PDFs and documents without readable pages", async () => {
    await expect(validateProductionPdf(Buffer.from("%PDF-corrupt"))).rejects.toThrow();
    const empty = await PDFDocument.create();
    await expect(validateProductionPdf(Buffer.from(await empty.save({ addDefaultPage: false })))).rejects.toThrow(/readable pages/);
  });
});
