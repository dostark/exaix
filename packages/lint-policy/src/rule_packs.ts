/**
 * @module ExaixRulePacks
 * @path packages/lint-policy/src/rule_packs.ts
 * @description The plugin name, rule packs, and registry that the Exaix lint plugin and the style checker share.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts]
 * @related-files [packages/lint-policy/plugin.ts, packages/lint-policy/src/rule_pack/mod.ts]
 */

import {
  createRuleRegistry,
  DENO_RULE_PACK,
  type IRulePack,
  type IRuleRegistry,
  TYPESCRIPT_RULE_PACK,
} from "@dostark/unslop-ts";
import { EXAIX_PLUGIN_NAME, EXAIX_RULE_PACK } from "./rule_pack/mod.ts";

export const EXAIX_RULE_PACKS: readonly IRulePack[] = [TYPESCRIPT_RULE_PACK, DENO_RULE_PACK, EXAIX_RULE_PACK];

export const EXAIX_REGISTRY: IRuleRegistry = createRuleRegistry(EXAIX_PLUGIN_NAME, EXAIX_RULE_PACKS);
