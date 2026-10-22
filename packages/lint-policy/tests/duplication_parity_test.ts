/**
 * @module DuplicationParityTest
 * @path packages/lint-policy/tests/duplication_parity_test.ts
 * @description Checks that the unslop-ts duplicate-type and duplicate-constant checks match the old script findings on a corpus and on the production tree.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/fs, @std/path, zod, @dostark/unslop-ts]
 * @related-files [packages/lint-policy/tests/fixtures/port/duplication_corpus.ts, packages/lint-policy/src/checkers/check_code_style.ts]
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, globToRegExp, relative } from "@std/path";
import { z } from "zod";
import {
  findDuplicateConstants,
  findDuplicateTypes,
  validateConstantAllowEntries,
  validateTypeAllowEntries,
} from "@dostark/unslop-ts/whole-tree";
import { classifyRepoPath } from "../src/checkers/check_code_style.ts";
import catalogJson from "./fixtures/catalog_v1.json" with { type: "json" };
import { loadPolicyCatalog } from "./helpers/catalog.ts";
import { DUPLICATION_CORPUS } from "./fixtures/port/duplication_corpus.ts";
import goldenJson from "./fixtures/port/duplication_golden.json" with { type: "json" };

const GoldenSchema = z.record(
  z.string(),
  z.object({
    duplicates: z.array(z.object({ name: z.string(), firstFile: z.string(), laterFile: z.string() })),
    stale: z.array(z.string()),
  }),
);
const golden = GoldenSchema.parse(goldenJson);
const catalog = loadPolicyCatalog(catalogJson);
const REPO_ROOT = fromFileUrl(new URL("../../..", import.meta.url));
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const SKIPPED = [/[/\\]\.git[/\\]/, /[/\\]node_modules[/\\]/, /[/\\]\.cache[/\\]/, /[/\\]exaix-dev-docs[/\\]/];

for (const entry of DUPLICATION_CORPUS) {
  Deno.test(`duplication parity: ${entry.name}`, () => {
    const expected = golden[entry.name];
    if (entry.kind === "type") {
      const options = { allow: entry.allow, minProperties: entry.minProperties };
      assertEquals(findDuplicateTypes(entry.units, options), expected.duplicates);
      assertEquals(validateTypeAllowEntries(entry.units, options), expected.stale);
    } else {
      const options = { allow: entry.allow, namePattern: entry.namePattern };
      assertEquals(findDuplicateConstants(entry.units, options), expected.duplicates);
      assertEquals(validateConstantAllowEntries(entry.units, options), expected.stale);
    }
  });
}

function productionUnits(
  key: string,
  all: readonly { path: string; text: string }[],
): { path: string; text: string }[] {
  const include = (catalog.rules[key].include ?? []).map((glob) =>
    globToRegExp(glob, { extended: true, globstar: true })
  );
  return all.filter((unit) =>
    classifyRepoPath(unit.path) === "prod" && include.some((pattern) => pattern.test(unit.path))
  );
}

Deno.test("duplication parity: the production tree has no duplicate type, no duplicate constant, and no stale allow entry", async () => {
  const all: { path: string; text: string }[] = [];
  for await (const entry of walk(REPO_ROOT, { includeDirs: false, exts: SOURCE_EXTENSIONS, skip: SKIPPED })) {
    all.push({ path: relative(REPO_ROOT, entry.path), text: await Deno.readTextFile(entry.path) });
  }
  const typeOptions = catalog.rules["duplicate-type"].options ?? {};
  const constantOptions = catalog.rules["duplicate-constant"].options ?? {};
  const typeUnits = productionUnits("duplicate-type", all);
  const constantUnits = productionUnits("duplicate-constant", all);
  assertEquals(findDuplicateTypes(typeUnits, typeOptions), []);
  assertEquals(validateTypeAllowEntries(typeUnits, typeOptions), []);
  assertEquals(findDuplicateConstants(constantUnits, constantOptions), []);
  assertEquals(validateConstantAllowEntries(constantUnits, constantOptions), []);
});

const HOST_SCRIPTS = [
  { path: "src/checkers/check_code_style.ts", imports: "findDuplicateTypes", defines: "function findDuplicateTypes" },
  {
    path: "src/checkers/check_magic_values.ts",
    imports: "findDuplicateConstants",
    defines: "function findDuplicateConstants",
  },
];

Deno.test("duplication parity: the host scripts import the library and keep no local copy", async () => {
  for (const script of HOST_SCRIPTS) {
    const text = await Deno.readTextFile(fromFileUrl(new URL(`../${script.path}`, import.meta.url)));
    assertEquals(text.includes(script.defines), false, `${script.path} still defines ${script.imports}`);
    assertEquals(text.includes(`${script.imports},`), true, `${script.path} does not import ${script.imports}`);
    assertEquals(
      text.includes("@dostark/unslop-ts/whole-tree"),
      true,
      `${script.path} does not use the whole-tree entry`,
    );
  }
});
