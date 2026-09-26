#!/usr/bin/env -S deno run -A
/**
 * @module CheckToolNaming
 * @path scripts/check_tool_naming.ts
 * @architectural-layer DeveloperTooling
 * @dependencies [@exaix/core, @exaix/tool-runtime, @exaix/mcp]
 * @related-files [packages/core/src/types/enums.ts, packages/core/src/types/tool_aliases.ts, tests/scripts/check_tool_naming_test.ts]
 * @description Naming gate for tool names: the `<verb>_<object>` convention, alias
 *   rules, McpToolName membership and retired native names in registrations.
 *
 * Usage:
 *   deno run -A scripts/check_tool_naming.ts
 *
 * Exit codes:
 *   0 — no violations
 *   1 — one or more violations
 */

import {
  isRejectedNativeToolName,
  MCP_ONLY_TOOL_NAMES,
  McpToolName,
  NATIVE_TOOL_NAMES,
  TOOL_ALIASES,
  TOOL_NAME_VERBS,
  ToolName,
} from "@exaix/core";
import { createCoreToolSchemas } from "@exaix/tool-runtime";
import { TOOL_MANIFEST } from "@exaix/mcp/manifest.ts";

const NAME_PATTERN = /^[a-z]+(_[a-z]+)+$/;
const EXAIX_PREFIX = "exaix_";

/** D1: every value must be `<verb>_<object>` snake_case with an allowed first token. */
export function findNamingViolations(
  toolNames: Readonly<Record<string, string>>,
  allowedVerbs: readonly string[],
): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(toolNames)) {
    if (isRejectedNativeToolName(value)) {
      errors.push(`ToolName.${key} = "${value}" exposes an excluded native name`);
      continue;
    }
    if (!NAME_PATTERN.test(value)) {
      errors.push(`ToolName.${key} = "${value}" does not match <verb>_<object> snake_case`);
      continue;
    }
    const firstToken = value.split("_")[0];
    if (!allowedVerbs.includes(firstToken)) {
      errors.push(`ToolName.${key} = "${value}" starts with disallowed verb "${firstToken}"`);
    }
  }
  return errors;
}

/** No alias may shadow a canonical name. No alias may target a native (Exaix-specific)
 *  tool. Native tools take no aliases under the v1.7 category policy. */
export function findAliasViolations(
  aliases: Readonly<Record<string, { canonical: string }>>,
  canonicalNames: ReadonlySet<string>,
  nativeNames: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const [alias, { canonical }] of Object.entries(aliases)) {
    if (canonicalNames.has(alias)) {
      errors.push(`TOOL_ALIASES["${alias}"] shadows the canonical name "${alias}"`);
    }
    if (nativeNames.has(canonical)) {
      errors.push(`TOOL_ALIASES["${alias}"] targets native tool "${canonical}" — native tools take no aliases`);
    }
  }
  return errors;
}

/** D8: every McpToolName value is a ToolName value, an `exaix_`-prefixed control-plane
 *  tool, or a declared MCP-only exception. */
export function findMcpOnlyViolations(
  mcpToolValues: readonly string[],
  toolNameValues: ReadonlySet<string>,
  mcpOnlyNames: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const value of mcpToolValues) {
    if (toolNameValues.has(value)) continue;
    if (value.startsWith(EXAIX_PREFIX)) continue;
    if (mcpOnlyNames.has(value)) continue;
    errors.push(`McpToolName "${value}" is neither a ToolName value, exaix_-prefixed, nor in MCP_ONLY_TOOL_NAMES`);
  }
  return errors;
}

/** A catalog or registration may expose only ToolName values, `exaix_` control-plane tools
 *  or declared MCP-only exceptions. It must never expose a retired or variant native name. */
export function findCatalogViolations(
  catalog: string,
  names: readonly string[],
  toolNameValues: ReadonlySet<string>,
  mcpOnlyNames: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const name of names) {
    if (isRejectedNativeToolName(name)) {
      errors.push(`${catalog} exposes the excluded native name "${name}"`);
      continue;
    }
    if (toolNameValues.has(name) || name.startsWith(EXAIX_PREFIX) || mcpOnlyNames.has(name)) continue;
    errors.push(`${catalog} exposes "${name}", which is not a ToolName value or a declared exception`);
  }
  return errors;
}

if (import.meta.main) {
  const canonicalToolNames = new Set<string>([...Object.values(ToolName), ...Object.values(McpToolName)]);
  const toolNameValues = new Set<string>(Object.values(ToolName));
  const mcpOnlyNames = new Set<string>(MCP_ONLY_TOOL_NAMES);
  const registryNames = createCoreToolSchemas().map((tool) => tool.name);
  const manifestNames = TOOL_MANIFEST.map((entry) => entry.name);

  const errors = [
    ...findNamingViolations(ToolName, TOOL_NAME_VERBS),
    ...findAliasViolations(TOOL_ALIASES, canonicalToolNames, NATIVE_TOOL_NAMES),
    ...findMcpOnlyViolations(Object.values(McpToolName), toolNameValues, mcpOnlyNames),
    ...findCatalogViolations("createCoreToolSchemas", registryNames, toolNameValues, mcpOnlyNames),
    ...findCatalogViolations("TOOL_MANIFEST", manifestNames, toolNameValues, mcpOnlyNames),
  ];

  console.log(
    `🔍 Checking tool naming: ${Object.keys(ToolName).length} ToolName value(s), ` +
      `${Object.keys(McpToolName).length} McpToolName value(s), ${Object.keys(TOOL_ALIASES).length} alias(es)...`,
  );

  if (errors.length > 0) {
    console.error("❌ Tool naming violations found:");
    for (const error of errors) console.error(`  • ${error}`);
    Deno.exit(1);
  }

  console.log("✅ Tool naming convention: all compliant.");
  Deno.exit(0);
}
