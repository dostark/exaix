/**
 * @module ExaixPolicyConfig
 * @path packages/lint-policy/src/policy_config.ts
 * @description Pure compiled policy from the version 2 config and descriptor; no plugin or checker.
 * @architectural-layer Tooling
 * @dependencies [@dostark/unslop-ts]
 * @related-files [packages/lint-policy/unslop.project.ts, packages/lint-policy/plugin.ts]
 */

import { compileConfig, type ICompiledConfig, type JsonValue } from "@dostark/unslop-ts";
import { descriptor } from "../unslop.project.ts";

const config = JSON.parse(
  Deno.readTextFileSync(new URL("../../../unslop.config.json", import.meta.url)),
) as JsonValue;

export const POLICY_CONFIG = config;
export const POLICY_COMPILED: ICompiledConfig = compileConfig(config as JsonValue, descriptor);
export const POLICY_CATALOG = POLICY_COMPILED.catalog;
