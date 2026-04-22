/**
 * @module ToolTestHelpers
 * @path tests/tools/helpers.ts
 * @description Shared setup helpers for tool registry tests.
 */

import { ToolRegistry } from "../../src/services/tool/tool_registry.ts";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { JSONObject } from "../../src/shared/types/json.ts";

interface ICreateRegistryOptions {
  tools?: JSONObject;
}

export function createToolRegistryForTests(tempDir: string, options: ICreateRegistryOptions = {}): ToolRegistry {
  const config = ConfigSchema.parse({
    system: { root: tempDir },
    tools: options.tools ?? {},
    paths: {},
    database: {},
    watcher: {},
    agents: {},
    models: {},
    portals: [],
    mcp: {},
  });

  return new ToolRegistry({ config, baseDir: tempDir });
}

export async function cleanupTempDir(tempDir: string): Promise<void> {
  await Deno.remove(tempDir, { recursive: true });
}
