/**
 * @module ExaixProjectDescriptor
 * @path packages/lint-policy/unslop.project.ts
 * @description The acyclic consumer descriptor: metadata and host commands, never a checker or plugin.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts]
 * @related-files [packages/lint-policy/src/script_rules.ts, packages/lint-policy/src/rule_packs.ts]
 */

import type { IProjectDescriptor } from "@dostark/unslop-ts";
import { EXAIX_PLUGIN_NAME } from "./src/rule_pack/mod.ts";
import { EXAIX_RULE_PACKS } from "./src/rule_packs.ts";
import { SCRIPT_RULES, WHOLE_TREE_HOSTS } from "./src/script_rules.ts";

const rootUrl = new URL("../../", import.meta.url);

/** The consumer project descriptor used before the version 2 config exists. */
export const descriptor: IProjectDescriptor = {
  pluginName: EXAIX_PLUGIN_NAME,
  rootUrl,
  configUrl: new URL("unslop.config.json", rootUrl),
  lintConfigUrl: new URL("deno.json", rootUrl),
  pluginUrl: new URL("packages/lint-policy/plugin.ts", rootUrl),
  packs: EXAIX_RULE_PACKS,
  scriptRules: SCRIPT_RULES,
  wholeTreeHosts: WHOLE_TREE_HOSTS,
};
