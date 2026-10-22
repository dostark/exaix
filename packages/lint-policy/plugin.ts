/**
 * @module ExaixLintPlugin
 * @path packages/lint-policy/plugin.ts
 * @description Entry point for the exaix Deno lint plugin and its compiled project view.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts]
 * @related-files [packages/lint-policy/src/policy_config.ts, packages/lint-policy/unslop.project.ts]
 */

import { createUnslopProject } from "@dostark/unslop-ts";
import { POLICY_CONFIG } from "./src/policy_config.ts";
import { descriptor } from "./unslop.project.ts";

export const project = createUnslopProject({ descriptor, config: POLICY_CONFIG });
export default project.plugin;
