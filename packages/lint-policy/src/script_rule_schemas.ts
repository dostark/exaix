/**
 * @module ExaixScriptRuleSchemas
 * @path packages/lint-policy/src/script_rule_schemas.ts
 * @description Option schemas for the consumer script rules; depends on layout, never on a checker.
 * @architectural-layer Tooling
 * @dependencies [zod, @dostark/unslop-ts/whole-tree]
 * @related-files [packages/lint-policy/src/checkers/check_code_style.ts, packages/lint-policy/src/script_rules.ts]
 */

import { z } from "zod";
import { DuplicateConstantOptionsSchema, DuplicateTypeOptionsSchema } from "@dostark/unslop-ts/whole-tree";
import type { ScriptRuleSchemas } from "@dostark/unslop-ts";
import { LAYOUT } from "./repo_layout.ts";

/** Option schemas for the script rules that read catalog options. */
export const SCRIPT_RULE_SCHEMAS: ScriptRuleSchemas = {
  "duplicate-constant": DuplicateConstantOptionsSchema,
  "duplicate-type": DuplicateTypeOptionsSchema,
  "edition-leak": z.object({
    soloTier: z.number().int().default(0),
    teamTier: z.number().int().default(1),
    enterpriseTier: z.number().int().default(2),
    soloPrefixes: z.array(z.string()).default([LAYOUT.packageRoot, LAYOUT.appRoot]),
    teamPrefixes: z.array(z.string()).default([LAYOUT.teamRoot]),
    enterprisePrefixes: z.array(z.string()).default([LAYOUT.enterpriseRoot]),
    teamAppPaths: z.array(z.string()).default([LAYOUT.teamAppBootstrap]),
  }).strict(),
};
