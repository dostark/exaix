/**
 * @module ToolCatalogParity
 * @path packages/mcp/src/tool_catalog_parity.ts
 * @description Compares ToolRegistry's in-process tool catalog (used by
 *   ReActLoopStrategy/LegacyAgentStrategy for ReAct-style tool execution)
 *   against the MCP tool manifest's advertised handler schemas (used by
 *   external MCP clients and DynamicStepExecutor's MCP-mediated tool calls),
 *   for the tools present in both. The two catalogs are independently
 *   maintained, so a tool present in both can silently drift into two
 *   different parameter contracts for the same logical operation (Phase 154).
 *   This module detects that drift; it does not resolve it.
 * @architectural-layer MCP
 * @related-files [packages/mcp/src/manifest.ts, packages/tool-runtime/src/tool_schemas.ts, scripts/check_tool_catalog_parity.ts]
 */
import type { ITool } from "@exaix/core/types";
import type { IToolManifestEntry } from "./manifest.ts";

/** Result of a tool-catalog parity check run. Mirrors checkToolResultParity()'s IParityCheckResult shape. */
export interface IToolCatalogParityResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  checkedTools: number;
}

/**
 * MCP-protocol auth/routing parameters present on every MCP_HANDLER-kind
 * tool's advertised input_schema but absent from ToolRegistry's schemas —
 * ToolRegistry executes within an already-resolved single-portal,
 * single-identity context (see DynamicStepExecutor/ReActLoopStrategy), so it
 * never accepts them. Excluded from comparison: including them would flag
 * every overlapping tool as a "divergence", drowning out genuine per-tool
 * parameter differences.
 */
const MCP_AUTH_ONLY_PARAMS: ReadonlySet<string> = new Set(["portal", "identity_id"]);

function withoutAuthParams(keys: Iterable<string>): Set<string> {
  return new Set([...keys].filter((key) => !MCP_AUTH_ONLY_PARAMS.has(key)));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function formatKeys(keys: Set<string>): string {
  return [...keys].sort().join(", ");
}

/**
 * Runs the parity comparison and returns a structured result (does NOT exit
 * or throw). For each ToolRegistry tool with a name-matching TOOL_MANIFEST
 * entry that has `input_schema` populated:
 *   - a required-param set mismatch (after excluding MCP auth-only params) is
 *     an `errors` entry (blocking);
 *   - an optional-param (full property set) mismatch is a `warnings` entry.
 * A ToolRegistry tool with no name-matching manifest entry is a `warnings`
 * entry (expected for internal-only tools with no MCP handler, e.g.
 * `deno_task`/`git_info`). Manifest entries with no name-matching
 * ToolRegistry tool, and manifest entries without `input_schema` populated
 * yet, are not visited — the comparison is driven from `registryTools`.
 */
export function checkToolCatalogParity(
  registryTools: ITool[],
  manifestEntries: IToolManifestEntry[],
): IToolCatalogParityResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const manifestByName = new Map(manifestEntries.map((entry) => [entry.name, entry]));

  for (const registryTool of registryTools) {
    const manifestEntry = manifestByName.get(registryTool.name);
    if (manifestEntry === undefined) {
      warnings.push(
        `Tool '${registryTool.name}': present in ToolRegistry but has no TOOL_MANIFEST entry ` +
          `(expected for internal-only tools with no MCP handler).`,
      );
      continue;
    }

    // Phase 112 Step 4: compare regardless of input_schema presence — side_effect_scope is a
    // non-optional TOOL_MANIFEST field, so input_schema-less internal-only tools (fetch_url,
    // grep_search, copy_file) must not be silently exempted from this check.
    if (
      registryTool.sideEffectScope !== undefined &&
      registryTool.sideEffectScope !== manifestEntry.side_effect_scope
    ) {
      errors.push(
        `Tool '${registryTool.name}': side-effect scope mismatch — ToolRegistry declares ` +
          `'${registryTool.sideEffectScope}', TOOL_MANIFEST declares '${manifestEntry.side_effect_scope}'.`,
      );
    }

    const inputSchema = manifestEntry.input_schema;
    if (inputSchema === undefined) {
      continue;
    }

    const registryRequired = withoutAuthParams(registryTool.parameters.required ?? []);
    const manifestRequired = withoutAuthParams(inputSchema.required ?? []);
    if (!setsEqual(registryRequired, manifestRequired)) {
      errors.push(
        `Tool '${registryTool.name}': required-param mismatch — ToolRegistry requires ` +
          `[${formatKeys(registryRequired)}], TOOL_MANIFEST requires [${formatKeys(manifestRequired)}].`,
      );
      continue;
    }

    const registryProps = withoutAuthParams(Object.keys(registryTool.parameters.properties));
    const manifestProps = withoutAuthParams(Object.keys(inputSchema.properties ?? {}));
    if (!setsEqual(registryProps, manifestProps)) {
      warnings.push(
        `Tool '${registryTool.name}': optional-param mismatch — ToolRegistry properties ` +
          `[${formatKeys(registryProps)}], TOOL_MANIFEST properties [${formatKeys(manifestProps)}].`,
      );
    }
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    checkedTools: registryTools.length,
  };
}
