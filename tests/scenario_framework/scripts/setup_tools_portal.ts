#!/usr/bin/env -S deno run --allow-all
/**
 * @module SetupToolsPortal
 * @path tests/scenario_framework/scripts/setup_tools_portal.ts
 * @architectural-layer Test
 * @description Prepares the fixture portal and config the `mcp_tools_extended` scenarios
 *   need in order to invoke real MCP tools. The tool handlers resolve a portal by alias
 *   out of `config.portals` and check the calling identity against `identities_allowed`,
 *   so a tool call is only possible against a config that declares both. Writes a
 *   scenario-scoped `tools_pack.config.toml` next to a fresh copy of the fixture portal.
 * @dependencies []
 * @related-files [tests/scenario_framework/fixtures/portals/tools_pack/, tests/scenario_framework/scripts/mcp_stdio_driver.ts]
 */

import { copy, ensureDir } from "@std/fs";
import { join, resolve } from "@std/path";

/** Alias the scenarios call tools against. */
export const TOOLS_PORTAL_ALIAS = "tools";
/** Identity the scenarios present; must appear in `identities_allowed` to be permitted. */
export const TOOLS_PORTAL_IDENTITY = "tools-eval";
/** Identity deliberately absent from `identities_allowed`, for the permission-refusal case. */
export const TOOLS_PORTAL_DENIED_IDENTITY = "not-allowed-identity";
/** Config file name the scenarios point `EXA_CONFIG_PATH` at. */
export const TOOLS_CONFIG_FILE = "tools_pack.config.toml";
/** Directory the fixture portal is copied into, relative to the workspace root. */
export const TOOLS_PORTAL_DIR = "tools-portal";

export function buildToolsConfigToml(workspaceRoot: string, portalPath: string): string {
  return [
    "[system]",
    `root = "${workspaceRoot}"`,
    'version = "1.0.0"',
    'log_level = "info"',
    "",
    "[[portals]]",
    `alias = "${TOOLS_PORTAL_ALIAS}"`,
    `target_path = "${portalPath}"`,
    'description = "tools pack fixture portal"',
    `identities_allowed = ["${TOOLS_PORTAL_IDENTITY}"]`,
    'operations = ["read", "write", "git"]',
    "",
  ].join("\n");
}

/**
 * Copy the fixture portal into the workspace and write the matching config.
 * The portal is recreated from scratch each run so mutating tools (write/patch/move/
 * delete) start from identical content and scenarios stay order-independent.
 */
export async function setupToolsPortal(
  workspaceRoot: string,
  fixturePortalPath: string,
): Promise<{ portalPath: string; configPath: string }> {
  const root = resolve(workspaceRoot);
  const portalPath = join(root, TOOLS_PORTAL_DIR);
  const configPath = join(root, TOOLS_CONFIG_FILE);

  await ensureDir(root);
  try {
    await Deno.remove(portalPath, { recursive: true });
  } catch { /* first run — nothing to clear */ }

  await copy(resolve(fixturePortalPath), portalPath, { overwrite: true });
  await Deno.writeTextFile(configPath, buildToolsConfigToml(root, portalPath));

  return { portalPath, configPath };
}

if (import.meta.main) {
  const [workspaceRoot, fixturePortalPath] = Deno.args;
  if (!workspaceRoot || !fixturePortalPath) {
    console.error("Usage: setup_tools_portal.ts <workspace-root> <fixture-portal-path>");
    Deno.exit(1);
  }
  const { portalPath, configPath } = await setupToolsPortal(workspaceRoot, fixturePortalPath);
  console.log(`tools portal ready: ${portalPath}`);
  console.log(`tools config ready: ${configPath}`);
}
