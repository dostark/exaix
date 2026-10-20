/**
 * @module CodeStyleAnchorTest
 * @path packages/lint-policy/tests/code_style_anchor_test.ts
 * @description Checks that CODE_STYLE.md holds Exaix rules only, and that the generic guide holds every generic section with the rule ids it names.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [packages/lint-policy/catalog.json, packages/lint-policy/tests/check_code_style_catalog_parity_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import catalogJson from "../catalog.json" with { type: "json" };

const REPO_ROOT = fromFileUrl(new URL("../../..", import.meta.url));
const CODE_STYLE = "CODE_STYLE.md";
const GUIDE = "unslop-ts/docs/style_guide.md";
const ANCHOR = /\{#([^}]+)\}/g;
const STUB = /\bmoved to the\b/i;
const NUMBERED_HEADING = /^#{2,4}\s+\d+\./m;
/** Headings of the generic rules, which live in the guide only. */
const GENERIC_HEADINGS: readonly string[] = [
  "Strict Type Safety",
  "Function & Method Complexity",
  "No Re-exporting",
  "Multi-line Named Imports",
  "Dynamic Imports",
  "No Inline Type Imports",
  "No Aliasing Interfaces on Import",
  "REDUNDANT_OPTIONAL",
  "UNUSED_OPTIONAL",
];
/** The generic sections of the guide and the rule ids that each one names. */
const GUIDE_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  "no-magic-values": ["magic-literals", "magic-union-type", "duplicate-constant", "duplicate-type"],
  "imports-at-the-top": ["import-inside-statement", "import-placement"],
  "interface-conventions": [
    "exported-interface-naming",
    "exported-interface-placement",
    "no-interface-rename-on-import",
  ],
  "import-boundaries": ["import-boundaries"],
  "module-order": ["require-module-header", "import-placement"],
  "test-fixtures": ["test-inline-multiline-fixture"],
  "deno-scripts": ["require-deno-shebang", "require-script-usage"],
};

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(join(REPO_ROOT, path));
}

/** The text of one guide section, up to the next heading of the same or a higher level. */
function sectionOf(guide: string, anchor: string): string {
  const start = guide.indexOf(`{#${anchor}}`);
  assert(start !== -1, `the guide has no section ${anchor}`);
  const headingStart = guide.lastIndexOf("\n", start) + 1;
  const level = guide.slice(headingStart).match(/^#+/)?.[0].length ?? 2;
  const next = guide.slice(start).search(new RegExp(`\\n#{1,${level}} `));
  return next === -1 ? guide.slice(headingStart) : guide.slice(headingStart, start + next);
}

Deno.test("CODE_STYLE.md has no moved stub, no numbered heading, and no generic-rule heading", async () => {
  const text = await read(CODE_STYLE);
  assertEquals(STUB.test(text), false, "a moved stub remains");
  assertEquals(NUMBERED_HEADING.test(text), false, "a numbered heading remains");
  const headings = text.split("\n").filter((line) => /^#{2,4} /.test(line));
  for (const generic of GENERIC_HEADINGS) {
    const match = headings.find((heading) => heading.includes(generic));
    assertEquals(match, undefined, `CODE_STYLE.md holds the generic heading: ${generic}`);
  }
});

Deno.test("every anchor that CODE_STYLE.md declares is unique", async () => {
  const anchors = [...(await read(CODE_STYLE)).matchAll(ANCHOR)].map((match) => match[1]);
  assertEquals(new Set(anchors).size, anchors.length);
});

Deno.test("each generic section of the guide exists and names its rule ids", async () => {
  const guide = await read(GUIDE);
  for (const [anchor, ids] of Object.entries(GUIDE_SECTIONS)) {
    const section = sectionOf(guide, anchor);
    for (const id of ids) assert(section.includes(`\`${id}\``), `section ${anchor} does not name ${id}`);
  }
});

Deno.test("every generic rule that the catalog ports points at the guide", () => {
  const rules = catalogJson.rules as Record<string, { codeStyle?: string }>;
  const ids = new Set(Object.values(GUIDE_SECTIONS).flat());
  for (const id of ids) {
    const entry = rules[id] ?? rules[`exaix/${id}`];
    if (entry === undefined || entry.codeStyle === undefined) continue;
    assert(entry.codeStyle.startsWith(GUIDE), `${id} points at ${entry.codeStyle}, not the guide`);
  }
});
