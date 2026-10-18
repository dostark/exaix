/**
 * @module LintPolicy
 * @path packages/lint-policy/mod.ts
 * @description Exaix lint policy: the edition-tier helpers that the style checker and the edition graph share.
 * @architectural-layer Tooling
 * @dependencies [@exaix/lint-rules]
 * @related-files [packages/lint-policy/src/checkers/check_code_style.ts, packages/lint-policy/plugin.ts]
 */

export { EDITION_TIERS, editionTierOfPath } from "./src/checkers/check_code_style.ts";
