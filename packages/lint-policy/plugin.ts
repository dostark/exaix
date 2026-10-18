/**
 * @module ExaixLintPlugin
 * @path packages/lint-policy/plugin.ts
 * @description Entry point for the exaix Deno lint plugin. It imports the validated style-rule
 *   catalog and default-exports the plugin. `deno lint` loads it through `deno.json` `lint.plugins`.
 * @architectural-layer Tooling
 * @dependencies [@exaix/lint-rules]
 * @related-files [packages/lint-policy/catalog.json, packages/lint-policy/src/rule_packs.ts, packages/lint-rules/mod.ts]
 */

import catalog from "./catalog.json" with { type: "json" };
import { createLintPlugin, parseCatalog } from "@exaix/lint-rules";
import { EXAIX_PLUGIN_NAME } from "./src/rule_pack/mod.ts";
import { EXAIX_REGISTRY, EXAIX_RULE_PACKS } from "./src/rule_packs.ts";

const parsed = parseCatalog(catalog, { scriptRuleSchemas: null, registry: EXAIX_REGISTRY });

export default createLintPlugin(EXAIX_PLUGIN_NAME, parsed, { rulePacks: EXAIX_RULE_PACKS });
