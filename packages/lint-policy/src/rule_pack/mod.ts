/**
 * @module ExaixRulePack
 * @path packages/lint-policy/src/rule_pack/mod.ts
 * @description The Exaix rule pack: the plugin rules that encode Exaix conventions.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts]
 * @related-files [packages/lint-policy/src/rule_packs.ts, packages/lint-policy/src/rule_pack/unslop_isolation.ts]
 */

import type { IRulePack } from "@dostark/unslop-ts";
import { createUnslopIsolation, UnslopIsolationOptions } from "./unslop_isolation.ts";

export const EXAIX_PLUGIN_NAME = "exaix";

export const EXAIX_RULE_PACK: IRulePack = {
  name: EXAIX_PLUGIN_NAME,
  rules: {
    "unslop-isolation": {
      overlaps: [],
      meta: {
        description: "An unslop module or an unslop-ts engine import outside the owning packages.",
        category: "boundaries",
        docs: "#unslop-isolation",
        preset: "opt-in",
        limits: "File names and static or literal dynamic import specifiers are checked; declarations are not.",
      },
      requiresTestGlobs: false,
      create: createUnslopIsolation,
    },
  },
  optionSchemas: { "unslop-isolation": UnslopIsolationOptions },
};
