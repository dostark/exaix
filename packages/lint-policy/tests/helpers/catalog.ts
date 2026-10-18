/**
 * @module PolicyCatalogTestHelper
 * @path packages/lint-policy/tests/helpers/catalog.ts
 * @description Loads a catalog against the Exaix registry, so tests parse it as the lint plugin does.
 * @architectural-layer Test
 * @dependencies [@dostark/unslop-ts]
 * @related-files [packages/lint-policy/src/rule_packs.ts, packages/lint-policy/catalog.json]
 */

import { type ICatalog, type JsonValue, parseCatalog, type ScriptRuleSchemas } from "@dostark/unslop-ts";
import { EXAIX_REGISTRY } from "../../src/rule_packs.ts";

/** Parses `input` with the Exaix registry and, optionally, the script-rule option schemas. */
export function loadPolicyCatalog(input: JsonValue, scriptRuleSchemas: ScriptRuleSchemas | null = null): ICatalog {
  return parseCatalog(input, { scriptRuleSchemas, registry: EXAIX_REGISTRY });
}
