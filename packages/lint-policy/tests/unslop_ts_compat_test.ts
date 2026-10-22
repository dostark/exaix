/**
 * @module UnslopTsCompatTest
 * @path packages/lint-policy/tests/unslop_ts_compat_test.ts
 * @description Proves that the embedded unslop-ts engine accepts the Exaix catalog: every plugin rule id resolves, and the whole-tree settings parse. The deploy task runs this test before it stages a new engine pointer.
 * @architectural-layer Test
 * @dependencies [@dostark/unslop-ts]
 * @related-files [scripts/deploy_unslop_ts.ts, packages/lint-policy/tests/fixtures/catalog_v1.json]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  createRuleRegistry,
  DENO_RULE_PACK,
  parseCatalog,
  parseWholeTreeSettings,
  TYPESCRIPT_RULE_PACK,
} from "@dostark/unslop-ts";
import { EXAIX_PLUGIN_NAME, EXAIX_RULE_PACK } from "../src/rule_pack/mod.ts";
import catalogJson from "./fixtures/catalog_v1.json" with { type: "json" };
import { POLICY_COMPILED } from "../src/policy_config.ts";

const PACKS = [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK, EXAIX_RULE_PACK];
const PLUGIN_ENGINE = "plugin";

Deno.test("the embedded engine parses the Exaix catalog against the three rule packs", () => {
  const registry = createRuleRegistry(EXAIX_PLUGIN_NAME, PACKS);
  const catalog = parseCatalog(catalogJson, { scriptRuleSchemas: null, registry });
  assertNotEquals(Object.keys(catalog.rules).length, 0);
});

Deno.test("every plugin rule id in the Exaix catalog resolves to a rule and an option schema", () => {
  const registry = createRuleRegistry(EXAIX_PLUGIN_NAME, PACKS);
  const pluginIds = Object.entries(catalogJson.rules)
    .filter(([, entry]) => entry.engine === PLUGIN_ENGINE)
    .map(([id]) => id);
  assertNotEquals(pluginIds.length, 0);
  const unresolved = pluginIds.filter((id) =>
    registry.implementation(id) === null || registry.optionSchema(id) === null
  );
  assertEquals(unresolved, []);
});

Deno.test("the embedded engine reads the whole-tree settings of the Exaix catalog", () => {
  const settings = parseWholeTreeSettings(catalogJson);
  assertEquals(settings.optionalParams?.pluginRuleId, `${EXAIX_PLUGIN_NAME}/require-optional-wrapper`);
});

Deno.test("embedded_engine_accepts_compiled_consumer_policy", () => {
  assertEquals(Object.keys(POLICY_COMPILED.rules).length, 59);
  assertEquals(POLICY_COMPILED.rules["exaix/no-explicit-unknown"].engine, "plugin");
  assertEquals(POLICY_COMPILED.rules["duplicate-type"].command, ["deno", "task", "check:style"]);
  assertEquals(POLICY_COMPILED.catalog.rules["duplicate-constant"].limits !== undefined, true);
});
