/**
 * Serialize structured data for a <script type="application/ld+json"> tag.
 *
 * JSON.stringify does not escape `<`, so a product title or description
 * containing `</script><script>…` (authored by a designer, or a future
 * customer-sourced field) would close the tag and inject markup into every
 * visitor's page. Escaping `<`, `>`, `&` and the JS line separators keeps the
 * output valid JSON and inert HTML.
 */
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}
