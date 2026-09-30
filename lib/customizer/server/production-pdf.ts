import { PDFDocument, PDFDict, PDFArray, PDFName, PDFRef, PDFStream, type PDFObject, StandardFonts } from "pdf-lib";

/** Manual source PDFs must retain their font resources, not depend on a workstation. */
export async function validateProductionPdf(bytes: Buffer) {
  const document = await PDFDocument.load(bytes);
  if (document.getPageCount() < 1 || document.getPageCount() > 100) throw new Error("Production PDF requires 1–100 readable pages.");
  const standard = new Set<string>(Object.values(StandardFonts));
  const visited = new Set<PDFObject>();
  const visit = (value?: PDFObject) => {
    if (!value) return;
    const object = value instanceof PDFRef ? document.context.lookup(value) : value;
    if (!object) throw new Error("Production PDF references a missing resource.");
    if (visited.has(object)) return;
    visited.add(object);
    if (visited.size > 50_000) throw new Error("Production PDF resource limit exceeded.");
    if (object instanceof PDFStream) { visit(object.dict); return; }
    if (object instanceof PDFArray) { for (let index = 0; index < object.size(); index++) visit(object.get(index)); return; }
    if (!(object instanceof PDFDict)) return;
    for (const key of object.keys()) visit(object.get(key));
    if (object.get(PDFName.of("Type"))?.toString() !== "/Font") return;
    const subtype = object.get(PDFName.of("Subtype"))?.toString();
    if (subtype === "/Type0") {
      if (!object.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray)?.size()) throw new Error("Production PDF font descendants are missing.");
      return; // Descendant CID font dictionaries were visited above.
    }
    if (subtype === "/Type3" && object.lookupMaybe(PDFName.of("CharProcs"), PDFDict)) return;
    const name = object.get(PDFName.of("BaseFont"));
    if (subtype === "/Type1" && name instanceof PDFName && standard.has(name.decodeText())) return;
    const descriptor = object.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
    if (!descriptor || !["FontFile", "FontFile2", "FontFile3"].some((key) => descriptor.lookup(PDFName.of(key)) instanceof PDFStream)) throw new Error("Production PDF has unembedded fonts; export a self-contained PDF before checkout.");
  };
  for (const [, object] of document.context.enumerateIndirectObjects()) visit(object);
}
