/**
 * @module ExaixRulePack
 * @path packages/lint-policy/src/rule_pack/mod.ts
 * @description The Exaix rule pack: the extension point for plugin rules that encode Exaix conventions. It holds no rule today.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts]
 * @related-files [packages/lint-policy/src/rule_packs.ts, packages/lint-policy/tests/fixtures/catalog_v1.json]
 */

import type { IRulePack } from "@dostark/unslop-ts";

export const EXAIX_PLUGIN_NAME = "exaix";

export const EXAIX_RULE_PACK: IRulePack = {
  name: EXAIX_PLUGIN_NAME,
  rules: {},
  optionSchemas: {},
};
