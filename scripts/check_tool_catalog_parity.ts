#!/usr/bin/env -S deno run -A
/**
 * @module CheckToolCatalogParity
 * @path scripts/check_tool_catalog_parity.ts
 * @description CLI wrapper around checkToolCatalogParity() (@exaix/mcp) — runs the
 * comparison between ToolRegistry's in-process tool catalog and the MCP tool
 * manifest's advertised handler schemas, and exits non-zero on any required-param
 * divergence. See packages/mcp/src/tool_catalog_parity.ts for the comparison logic.
 *
 * Exits with code 1 when any parity violation is found.
 *
 * Usage:
 *   deno run -A scripts/check_tool_catalog_parity.ts
 */

import { checkToolCatalogParity } from "@exaix/mcp/tool_catalog_parity.ts";
import { TOOL_MANIFEST } from "@exaix/mcp/manifest.ts";
import { createCoreToolSchemas } from "@exaix/tool-runtime";

if (import.meta.main) {
  const result = checkToolCatalogParity(createCoreToolSchemas(), TOOL_MANIFEST);

  console.log(`🔍 Checking tool catalog parity across ${result.checkedTools} ToolRegistry tools...`);

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.warn(`  ⚠️  ${warning}`);
    }
  }

  if (result.success) {
    console.log("✅ Tool catalog parity check passed.");
    Deno.exit(0);
  }

  console.error("❌ Tool catalog parity violations found:");
  for (const error of result.errors) {
    console.error(`  • ${error}`);
  }
  Deno.exit(1);
}
