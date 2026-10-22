/**
 * @module ExaixLintPlugin
 * @path packages/lint-policy/plugin.ts
 * @description Entry point for the exaix Deno lint plugin and its compiled project view.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts]
 * @related-files [packages/lint-policy/src/policy_config.ts, packages/lint-policy/unslop.project.ts]
 */

import { createLintPlugin } from "@dostark/unslop-ts";
import { POLICY_CATALOG, POLICY_COMPILED, POLICY_CONFIG } from "./src/policy_config.ts";
import { EXAIX_PLUGIN_NAME } from "./src/rule_pack/mod.ts";
import { EXAIX_RULE_PACKS } from "./src/rule_packs.ts";
import { descriptor } from "./unslop.project.ts";

export const project = {
  descriptor,
  config: POLICY_CONFIG,
  compiled: POLICY_COMPILED,
  plugin: createLintPlugin(EXAIX_PLUGIN_NAME, POLICY_CATALOG, { rulePacks: EXAIX_RULE_PACKS }),
};
export default project.plugin;
