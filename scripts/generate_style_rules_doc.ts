#!/usr/bin/env -S deno run -A
/**
 * @module GenerateStyleRulesDoc
 * @path scripts/generate_style_rules_doc.ts
 * @description Regenerates the rule reference, tag index, and analysis-boundaries sections
 *   of packages/lint-policy/docs/style_rules.md from packages/lint-policy/tests/fixtures/catalog_v1.json.
 *
 * Usage:
 *   deno run -A scripts/generate_style_rules_doc.ts   # rewrite the generated block
 *
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [packages/lint-policy/docs/style_rules.md, packages/lint-policy/tests/fixtures/catalog_v1.json]
 */

import { POLICY_CATALOG } from "../packages/lint-policy/src/policy_config.ts";
import { join } from "@std/path";

const BEGIN_MARKER = "<!-- BEGIN GENERATED RULE REFERENCE -->";
const END_MARKER = "<!-- END GENERATED RULE REFERENCE -->";

interface IRuleEntry {
  readonly engine?: string;
  readonly severity?: string;
  readonly scope?: string;
  readonly tags?: readonly string[];
  readonly limits?: string;
}

interface ICatalog {
  readonly tagVocabulary: Record<string, { description?: string }>;
  readonly rules: Record<string, IRuleEntry>;
}

const docPath = "packages/lint-policy/docs/style_rules.md";

interface ICellTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function renderTable(table: ICellTable): string {
  const header = `| ${table.headers.join(" | ")} |`;
  const divider = `| ${table.headers.map(() => "---").join(" | ")} |`;
  const rows = table.rows.map((row) => `| ${row.join(" | ")} |`);
  return [header, divider, ...rows].join("\n");
}

function rulesTable(catalog: ICatalog): string {
  const rows = Object.entries(catalog.rules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, entry]) => [
      `\`${id}\``,
      entry.engine ?? "script",
      entry.severity ?? "error",
      entry.scope ?? "all",
      (entry.tags ?? []).map((tag) => `\`${tag}\``).join(", "),
      entry.limits ? entry.limits : "—",
    ]);
  return renderTable({ headers: ["Rule", "Engine", "Severity", "Scope", "Tags", "Limits"], rows });
}

function tagIndexTable(catalog: ICatalog): string {
  const rows = Object.entries(catalog.tagVocabulary)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, meta]) => {
      const users = Object.entries(catalog.rules)
        .filter(([, entry]) => (entry.tags ?? []).includes(tag))
        .map(([id]) => `\`${id}\``)
        .join(", ");
      return [`\`${tag}\``, meta.description ?? "", users || "—"];
    });
  return renderTable({ headers: ["Tag", "Description", "Rules"], rows });
}

function boundariesTable(catalog: ICatalog): string {
  const rows = Object.entries(catalog.rules)
    .filter(([, entry]) => entry.limits)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, entry]) => [`\`${id}\``, entry.limits ?? "—"]);
  return renderTable({ headers: ["Rule", "Limits"], rows });
}

/** Builds the generated documentation block from the catalog. */
export function buildGeneratedBlock(catalog: ICatalog): string {
  return [
    BEGIN_MARKER,
    "## Rule reference",
    "",
    rulesTable(catalog),
    "",
    "## Tag index",
    "",
    tagIndexTable(catalog),
    "",
    "## Analysis boundaries",
    "",
    boundariesTable(catalog),
    END_MARKER,
  ].join("\n");
}

function replaceBlock(doc: string, block: string): string {
  const start = doc.indexOf(BEGIN_MARKER);
  const end = doc.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Generated markers not found in ${docPath}.`);
  }
  return doc.slice(0, start) + block + doc.slice(end + END_MARKER.length);
}

async function main(): Promise<void> {
  const catalog: ICatalog = POLICY_CATALOG;
  const doc = await Deno.readTextFile(docPath);
  const updated = replaceBlock(doc, buildGeneratedBlock(catalog));
  await Deno.writeTextFile(docPath, updated);
  console.log(`Updated ${join(docPath)}.`);
}

if (import.meta.main) {
  await main();
}
