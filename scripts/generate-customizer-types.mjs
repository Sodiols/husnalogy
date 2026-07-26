import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = path.join(root, "supabase", "customizer_v2.sql");
const outputPath = path.join(root, "lib", "supabase", "database.types.ts");
const sql = readFileSync(sqlPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

const requestedTables = [
  "product_customizer_templates",
  "product_customizations",
  "customizer_template_versions",
  "customizer_asset_categories",
  "customizer_assets",
  "customer_asset_library",
  "customizer_mockup_templates",
  "customizer_mockup_views",
  "customizer_mockup_artwork_areas",
  "customizer_mockup_overlays",
  "customizer_guides",
  "customizer_render_jobs",
  "customizer_render_outputs",
  "customizer_preflight_results",
  "order_design_snapshots",
  "customizer_feature_flags",
  "customizer_audit_logs",
];

function splitTopLevel(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'" && value[index - 1] !== "\\") quote = !quote;
    if (quote) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function matchingParen(source, openIndex) {
  let depth = 0;
  let quote = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "'" && source[index - 1] !== "\\") quote = !quote;
    if (quote) continue;
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unclosed table definition at byte ${openIndex}`);
}

function tsType(definition) {
  const normalized = definition.toLowerCase().replace(/\s+/g, " ");
  if (/\bjsonb?\b/.test(normalized)) return "Json";
  if (/\b(?:smallint|integer|bigint|numeric|decimal|real|double precision)\b/.test(normalized)) return "number";
  if (/\bboolean\b/.test(normalized)) return "boolean";
  if (/\b(?:text|uuid|varchar|character varying|timestamp|date|time|inet|citext)\b/.test(normalized)) return "string";
  throw new Error(`Unsupported SQL type in: ${definition}`);
}

function parseColumn(fragment) {
  const value = fragment.trim().replace(/^add\s+column\s+if\s+not\s+exists\s+/i, "");
  if (/^(?:constraint|primary\s+key|foreign\s+key|unique|check)\b/i.test(value)) return null;
  const match = value.match(/^"?([a-z_][a-z0-9_]*)"?\s+(.+)$/i);
  if (!match) return null;
  const [, name, definition] = match;
  return {
    name,
    type: tsType(definition),
    nullable: !/\bnot\s+null\b|\bprimary\s+key\b/i.test(definition),
    defaulted: /\bdefault\b|\bgenerated\b|\bserial\b/i.test(definition),
  };
}

const tables = new Map();
const createPattern = /create\s+table\s+if\s+not\s+exists\s+public\.([a-z_][a-z0-9_]*)\s*\(/gi;
for (const match of sql.matchAll(createPattern)) {
  const table = match[1];
  if (!requestedTables.includes(table)) continue;
  const openIndex = match.index + match[0].lastIndexOf("(");
  const closeIndex = matchingParen(sql, openIndex);
  const columns = splitTopLevel(sql.slice(openIndex + 1, closeIndex)).map(parseColumn).filter(Boolean);
  tables.set(table, new Map(columns.map((column) => [column.name, column])));
}

const alterPattern = /alter\s+table\s+public\.([a-z_][a-z0-9_]*)\s+([\s\S]*?);/gi;
for (const match of sql.matchAll(alterPattern)) {
  const table = match[1];
  if (!tables.has(table) || !/\badd\s+column\s+if\s+not\s+exists\b/i.test(match[2])) continue;
  for (const fragment of splitTopLevel(match[2])) {
    if (!/^add\s+column\s+if\s+not\s+exists\b/i.test(fragment)) continue;
    const column = parseColumn(fragment);
    if (column) tables.get(table).set(column.name, column);
  }
}

const missing = requestedTables.filter((table) => !tables.has(table));
if (missing.length) throw new Error(`Canonical SQL is missing type sources for: ${missing.join(", ")}`);

function property(column, mode) {
  const nullableType = column.nullable ? `${column.type} | null` : column.type;
  if (mode === "row") return `          ${column.name}: ${nullableType}`;
  if (mode === "insert") {
    const optional = column.nullable || column.defaulted ? "?" : "";
    return `          ${column.name}${optional}: ${nullableType}`;
  }
  return `          ${column.name}?: ${nullableType}`;
}

const tableBlocks = requestedTables.map((table) => {
  const columns = [...tables.get(table).values()];
  return `      ${table}: {\n+        Row: {\n+${columns.map((column) => property(column, "row")).join("\n")}\n+        }\n+        Insert: {\n+${columns.map((column) => property(column, "insert")).join("\n")}\n+        }\n+        Update: {\n+${columns.map((column) => property(column, "update")).join("\n")}\n+        }\n+        Relationships: []\n+      }`;
}).join("\n");

const output = `/* eslint-disable */\n+/**\n+ * GENERATED FILE - DO NOT EDIT BY HAND.\n+ * Source: supabase/customizer_v2.sql\n+ * Generator: npm run generate:customizer:types\n+ *\n+ * This checked-in snapshot makes the Customizer V2 database contract available\n+ * without a live project. Before a production deployment, regenerate the full\n+ * project types with the Supabase CLI and reconcile any intentional differences.\n+ */\n+\n+export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]\n+\n+export type Database = {\n+  public: {\n+    Tables: {\n+${tableBlocks}\n+    }\n+    Views: Record<string, never>\n+    Functions: Record<string, never>\n+    Enums: Record<string, never>\n+    CompositeTypes: Record<string, never>\n+  }\n+}\n+\n+export type CustomizerTableName = keyof Database["public"]["Tables"]\n+export type CustomizerRow<Table extends CustomizerTableName> = Database["public"]["Tables"][Table]["Row"]\n+export type CustomizerInsert<Table extends CustomizerTableName> = Database["public"]["Tables"][Table]["Insert"]\n+export type CustomizerUpdate<Table extends CustomizerTableName> = Database["public"]["Tables"][Table]["Update"]\n+`;

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, output.replace(/^\/\* eslint-disable \*\/\r?\n/, "").replace(/^\+/gm, ""), "utf8");
console.log(`Generated ${path.relative(root, outputPath)} from ${path.relative(root, sqlPath)} (${requestedTables.length} tables).`);
