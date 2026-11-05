#!/usr/bin/env -S deno run -A
/**
 * @module GodObjectsCompare
 * @path scripts/god_objects_compare.ts
 * @description Runs the class strategy comparison through its lint-policy owner.
 * @architectural-layer Tooling
 * @dependencies [@exaix/lint-policy]
 * @related-files [packages/lint-policy/src/tools/god_objects_compare.ts]
 *
 * Usage:
 *   deno run -A scripts/god_objects_compare.ts [--rule=exaix/max-class-size] [--roots=packages,apps]
 *     [--config=unslop.config.json] [--descriptor=packages/lint-policy/unslop.project.ts]
 *     [--ceilings=packages/lint-policy/rule_ceilings.json]
 */
import { runGodObjectsCompare } from "../packages/lint-policy/src/tools/god_objects_compare.ts";

if (import.meta.main) await runGodObjectsCompare();
