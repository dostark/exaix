/**
 * @module CheckCodeStyleCatalogParityTest
 * @path packages/lint-policy/tests/check_code_style_catalog_parity_test.ts
 * @description Parity between the catalog, the generated rule reference, both engines,
 *   `deno.json`, and the repository path policy.
 * @architectural-layer Test
 * @related-files [packages/lint-policy/docs/style_rules.md, packages/lint-policy/src/checkers/check_code_style.ts]
 */

import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join } from "@std/path";
import { IMPLEMENTED_SCRIPT_RULE_IDS } from "../src/checkers/check_code_style.ts";
import { EXAIX_REGISTRY } from "../src/rule_packs.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..", "..");
const DOC_PATH = join(REPO_ROOT, "packages/lint-policy/docs/style_rules.md");
const CATALOG_PATH = join(REPO_ROOT, "packages/lint-policy/catalog.json");
const ENGINE_SRC = "packages/lint-rules/src";
const POLICY_SRC = "packages/lint-policy/src";

interface IRuleEntry {
  engine: string;
  tags: string[];
  exclusionCodes?: Record<string, string>;
}
interface ICatalog {
  tagVocabulary: Record<string, { description?: string }>;
  rules: Record<string, IRuleEntry>;
}

const catalog = JSON.parse(await Deno.readTextFile(CATALOG_PATH)) as ICatalog;
const doc = await Deno.readTextFile(DOC_PATH);

/** Parses the generated `## Rule reference` table into id → tags. */
function parseDocRules(markdown: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const section = markdown.split("## Rule reference")[1]?.split("## Tag index")[0] ?? "";
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 7 || !/^`.+`$/.test(cells[1])) continue;
    const id = cells[1].slice(1, -1);
    const tags = [...cells[5].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    result.set(id, tags);
  }
  return result;
}

const docRules = parseDocRules(doc);

Deno.test("catalog rule ids and tags equal the generated rule reference", () => {
  const catalogIds = new Set(Object.keys(catalog.rules));
  assertEquals(new Set(docRules.keys()), catalogIds);
  for (const [id, entry] of Object.entries(catalog.rules)) {
    assertEquals([...docRules.get(id)!].sort(), [...entry.tags].sort(), `tags differ for ${id}`);
  }
});

Deno.test("every rule id is implemented by exactly one engine", () => {
  for (const [id, entry] of Object.entries(catalog.rules)) {
    if (entry.engine === "plugin") {
      assert(EXAIX_REGISTRY.implementation(id) !== null, `plugin rule ${id} has no implementation`);
      assert(!IMPLEMENTED_SCRIPT_RULE_IDS.has(id), `plugin rule ${id} is also a script rule`);
    } else {
      assert(IMPLEMENTED_SCRIPT_RULE_IDS.has(id), `script rule ${id} has no implementation`);
      assert(EXAIX_REGISTRY.implementation(id) === null, `script rule ${id} is also a plugin rule`);
    }
  }
  for (const id of IMPLEMENTED_SCRIPT_RULE_IDS) {
    assertEquals(catalog.rules[id]?.engine, "script", `implemented script rule ${id} is not in the catalog`);
  }
});

Deno.test("deno.json lint.rules.exclude lists no exaix rule id", async () => {
  const denoJson = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json"))) as {
    lint?: { rules?: { exclude?: string[] } };
  };
  for (const id of denoJson.lint?.rules?.exclude ?? []) {
    assert(!id.startsWith("exaix/"), `deno.json excludes the exaix rule ${id}`);
  }
});

Deno.test("every exclusion code is used by a style-exclude line in the tree", async () => {
  const used = new Set<string>();
  for await (
    const entry of walk(REPO_ROOT, {
      includeDirs: false,
      exts: [".ts", ".tsx"],
      skip: [/[/\\]\.git[/\\]/, /[/\\]node_modules[/\\]/, /[/\\]dist[/\\]/, /[/\\]coverage[/\\]/],
    })
  ) {
    const text = await Deno.readTextFile(entry.path);
    for (const match of text.matchAll(/style-exclude:([A-Z0-9_]+)/g)) used.add(match[1]);
  }
  for (const [id, entry] of Object.entries(catalog.rules)) {
    for (const code of Object.keys(entry.exclusionCodes ?? {})) {
      assert(used.has(code), `exclusion code ${code} of ${id} is never used by a style-exclude line`);
    }
  }
});

const GUIDE_DOCS: readonly string[] = [
  "packages/lint-rules/docs/style_guide.md",
  "packages/lint-policy/docs/style_guide.md",
  "packages/lint-policy/docs/style_rules.md",
];

/** Removes comments and import/export module specifiers, keeping executable code. */
function stripNonCode(source: string): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlock
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .filter((line) => !/^\s*(import|export)\b.*\bfrom\b/.test(line))
    .join("\n");
}

const PATH_TOKEN = /(?<!@)(?:packages\/|apps\/|exaix-team\/|exaix-enterprise\/|tests\/|scripts\/|src\/)/g;
const EXAIX_SYMBOL = /@exaix\/|EventLogger|ConfigService/;

Deno.test("no repository path literal lives in the package sources", async () => {
  for (const root of [ENGINE_SRC, POLICY_SRC]) {
    for await (const entry of walk(join(REPO_ROOT, root), { includeDirs: false, exts: [".ts"] })) {
      const code = stripNonCode(await Deno.readTextFile(entry.path));
      const matches = [...code.matchAll(PATH_TOKEN)].map((m) => m[0]);
      assertEquals(matches, [], `${entry.path} contains repository path literal(s): ${matches.join(", ")}`);
    }
  }
});

Deno.test("the generic rule areas name no Exaix symbol", async () => {
  for (const area of ["engine", "rules"]) {
    for await (
      const entry of walk(join(REPO_ROOT, ENGINE_SRC, area), { includeDirs: false, exts: [".ts"] })
    ) {
      const code = stripNonCode(await Deno.readTextFile(entry.path));
      assert(
        !EXAIX_SYMBOL.test(code),
        `${entry.path} names an Exaix symbol in the generic rule area`,
      );
      assertEquals([...code.matchAll(PATH_TOKEN)].length, 0, `${entry.path} contains a repository path literal`);
    }
  }
});

Deno.test("every catalog codeStyle target resolves to an existing heading", async () => {
  const codeStyleDoc = await Deno.readTextFile(join(REPO_ROOT, "CODE_STYLE.md"));
  const anchorsOf = (text: string) => new Set([...text.matchAll(/\{#([^}]+)\}/g)].map((m) => m[1]));
  const docs: Record<string, Set<string>> = { "CODE_STYLE.md": anchorsOf(codeStyleDoc) };
  for (const extra of GUIDE_DOCS) {
    try {
      docs[extra] = anchorsOf(await Deno.readTextFile(join(REPO_ROOT, extra)));
    } catch {
      // The guide is added by a later step; fall back to CODE_STYLE.md anchors.
    }
  }
  for (const [id, entry] of Object.entries(catalog.rules)) {
    const target = (entry as { codeStyle?: string }).codeStyle;
    if (!target) continue;
    const [doc, anchor] = target.split("#");
    assert(anchor, `${id} has no anchor in its codeStyle target`);
    const anchors = docs[doc];
    assert(anchors, `${id} names an unknown doc: ${doc}`);
    assert(anchors.has(anchor), `${id}: '${anchor}' does not resolve to a heading in ${doc}`);
  }
});

const GENERIC_GUIDE = "packages/lint-rules/docs/style_guide.md";
const POLICY_GUIDE = "packages/lint-policy/docs/style_guide.md";
const EXAIX_ONLY_TOKENS: readonly string[] = ["exaix", "check_magic_values"];
const POLICY_GUIDE_SECTIONS: readonly string[] = [
  "Magic Values",
  "Canonical Subpackage Boundary",
  "Interface Aliasing Exception",
  "Comment Discipline Additions",
  "Enforcement Status",
];

Deno.test("the generic style guide holds no Exaix-specific content", async () => {
  const generic = (await Deno.readTextFile(join(REPO_ROOT, GENERIC_GUIDE))).toLowerCase();
  for (const token of EXAIX_ONLY_TOKENS) {
    assertFalse(generic.includes(token), `${GENERIC_GUIDE} still names ${token}`);
  }
});

Deno.test("the lint-policy style guide holds the Exaix sections split out of the generic guide", async () => {
  const policy = await Deno.readTextFile(join(REPO_ROOT, POLICY_GUIDE));
  for (const section of POLICY_GUIDE_SECTIONS) {
    assertStringIncludes(policy, `## ${section}`);
  }
});

Deno.test("the generated reference renders every tag", () => {
  for (const tag of Object.keys(catalog.tagVocabulary)) {
    assertStringIncludes(doc, `\`${tag}\``, `tag ${tag} is missing from the reference`);
  }
});
