/**
 * @module ExportedInterfaceNamingTest
 * @path packages/lint-policy/tests/exported_interface_naming_test.ts
 * @description Named valid and invalid cases for the exaix/exported-interface-naming plugin rule.
 * @architectural-layer Test
 * @related-files [packages/lint-policy/catalog.json, packages/lint-policy/src/rule_packs.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { createLintPlugin, runPlugin } from "@dostark/unslop-ts";
import { EXAIX_PLUGIN_NAME } from "../src/rule_pack/mod.ts";
import { EXAIX_RULE_PACKS } from "../src/rule_packs.ts";
import catalogJson from "../catalog.json" with { type: "json" };
import { loadPolicyCatalog } from "./helpers/catalog.ts";

const RULE_ID = "exaix/exported-interface-naming";
const SELECTION_VARIABLE = "EXAIX_LINT_RULES";
const FILE = "packages/x/src/a.ts";

/** Runs the Exaix plugin on one source with the selection variable cleared. */
function diagnosticsFor(source: string): { id: string; message: string }[] {
  const previous = Deno.env.get(SELECTION_VARIABLE) ?? null;
  try {
    Deno.env.delete(SELECTION_VARIABLE);
    const plugin = createLintPlugin(EXAIX_PLUGIN_NAME, loadPolicyCatalog(catalogJson), {
      rulePacks: EXAIX_RULE_PACKS,
    });
    return runPlugin(plugin, FILE, source).filter((diagnostic) => diagnostic.id === RULE_ID);
  } finally {
    if (previous !== null) Deno.env.set(SELECTION_VARIABLE, previous);
  }
}

Deno.test("exported-interface-naming accepts names with a capital I prefix", () => {
  const valid: readonly (readonly [string, string])[] = [
    ["a prefixed name", "export interface IFoo {}"],
    ["the bare letter I", "export interface I {}"],
    ["a digit after the I", "export interface I2c {}"],
    ["an underscore after the I", "export interface I_x {}"],
    ["a non-exported interface", "interface Foo {}"],
    ["a type alias", "export type Foo = string;"],
    ["a default export, which the rule does not cover", "export default interface Foo {}"],
  ];
  for (const [name, source] of valid) {
    assertEquals(diagnosticsFor(source).length, 0, `expected no report for: ${name}`);
  }
});

Deno.test("exported-interface-naming reports names without a capital I prefix", () => {
  const invalid: readonly (readonly [string, string, string])[] = [
    ["no prefix", "export interface Foo {}", "Foo"],
    ["a lowercase letter after the I", "export interface Ifoo {}", "Ifoo"],
    ["a word that starts with I", "export interface Interface {}", "Interface"],
    ["a declared interface", "export declare interface Foo {}", "Foo"],
  ];
  for (const [name, source, interfaceName] of invalid) {
    const found = diagnosticsFor(source);
    assertEquals(found.length, 1, `expected one report for: ${name}`);
    assertStringIncludes(found[0].message, `'${interfaceName}'`);
    assertStringIncludes(found[0].message, "capital 'I'");
  }
});

Deno.test("the catalog declares exported-interface-naming as an error-level plugin rule", () => {
  const entry = (catalogJson.rules as Record<string, { engine: string; severity: string }>)[RULE_ID];
  assertEquals(entry.engine, "plugin");
  assertEquals(entry.severity, "error");
  assertEquals("exported-interface-naming" in catalogJson.rules, false);
});
