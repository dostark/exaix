/**
 * @module OptionDocumentationTest
 * @path packages/lint-policy/tests/option_documentation_test.ts
 * @description Proves that the regular expression and magic-number option examples in the READMEs match the engine and the magic host.
 * @architectural-layer Test
 * @dependencies [@std/assert, @dostark/unslop-ts]
 * @related-files [packages/lint-policy/src/checkers/check_magic_values.ts, packages/lint-policy/README.md]
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  CatalogError,
  createRuleRegistry,
  DENO_RULE_PACK,
  type JsonValue,
  parseCatalog,
  parseWholeTreeSettings,
  TYPESCRIPT_RULE_PACK,
} from "@dostark/unslop-ts";

const ENGINE_README = new URL("../../../unslop-ts/README.md", import.meta.url);
const POLICY_README = new URL("../README.md", import.meta.url);
const MAGIC_HOST = new URL("../src/checkers/check_magic_values.ts", import.meta.url);
const SECTION_HEADING = "## Option validation";
const JSON_FENCE = /```json\n([\s\S]*?)\n```/;
const PLUGIN_NAME = "demo";
const PHRASE_RULE = "demo/ephemeral-comment";
const DISABLE_FLAGS = ["--no-numbers", "--strings-only"];

const DOCUMENTED_PATTERN = String.raw`"pattern": "\\btried\\b"`;
const DOCUMENTED_FLAGS = '"flags": "gi"';

async function documentedBlock(): Promise<string> {
  const text = await Deno.readTextFile(ENGINE_README);
  const start = text.indexOf(SECTION_HEADING);
  assert(start >= 0, "the engine README has no option validation section");
  const block = JSON_FENCE.exec(text.slice(start));
  assert(block !== null, "the option validation section has no json example");
  assertStringIncludes(block[1], DOCUMENTED_PATTERN);
  assertStringIncludes(block[1], DOCUMENTED_FLAGS);
  return block[1];
}

function parse(catalog: JsonValue) {
  const registry = createRuleRegistry(PLUGIN_NAME, [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK]);
  const base = { version: "1", scopes: { test: [], fixture: [] }, tagVocabulary: { demo: { description: "d" } } };
  return parseCatalog({ ...base, ...(catalog as Record<string, JsonValue>) }, { scriptRuleSchemas: null, registry });
}

Deno.test("regex_and_magic_option_documentation_matches_runtime", async () => {
  const block = await documentedBlock();
  const catalog: JsonValue = JSON.parse(block);
  assertEquals(Object.keys(parse(catalog).rules), [PHRASE_RULE]);
  const settings = parseWholeTreeSettings(catalog);
  assertEquals(settings.magicLiterals?.checkNumbers, false);
  assertEquals(settings.magicLiterals?.testScaffoldPattern, "^scaffold-");

  const brokenPattern = JSON.parse(block.replace(DOCUMENTED_PATTERN, '"pattern": "["'));
  assertThrows(() => parse(brokenPattern), CatalogError, "pattern");
  const repeatedFlag = JSON.parse(block.replace(DOCUMENTED_FLAGS, '"flags": "gg"'));
  assertThrows(() => parse(repeatedFlag), CatalogError, "flags");
  for (const flags of ["g", "y"]) parse(JSON.parse(block.replace(DOCUMENTED_FLAGS, `"flags": "${flags}"`)));

  assertStringIncludes(await Deno.readTextFile(ENGINE_README), "no flag turns them on");
  const policyText = await Deno.readTextFile(POLICY_README);
  const hostText = await Deno.readTextFile(MAGIC_HOST);
  for (const flag of DISABLE_FLAGS) {
    assertStringIncludes(policyText, flag);
    assertStringIncludes(hostText, flag);
  }
});
