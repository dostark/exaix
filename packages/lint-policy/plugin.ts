/**
 * @module ExaixLintPlugin
 * @path packages/lint-policy/plugin.ts
 * @description Entry point for the exaix Deno lint plugin, backed by the compiled policy.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts]
 * @related-files [packages/lint-policy/src/policy_config.ts, packages/lint-policy/src/rule_packs.ts]
 */

import { createLintPlugin } from "@dostark/unslop-ts";
import { POLICY_CATALOG } from "./src/policy_config.ts";
import { EXAIX_PLUGIN_NAME } from "./src/rule_pack/mod.ts";
import { EXAIX_RULE_PACKS } from "./src/rule_packs.ts";

export default createLintPlugin(EXAIX_PLUGIN_NAME, POLICY_CATALOG, { rulePacks: EXAIX_RULE_PACKS });
