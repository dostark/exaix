/**
 * @module ToolRegistrySearchMemoryTest
 * @path packages/tool-runtime/tests/tool_registry_search_memory_test.ts
 * @description Verifies the Solo-tier search_memory tool: registered on
 * ToolRegistry, callable end to end against IMemoryService.search scoped to the current
 * portal, ignoring any caller-supplied portal argument, and erroring gracefully (never
 * throwing) when no memory service is configured. Mirrors the query_relationships/
 * who_depends_on precedent in tool_registry_relationship_query_test.ts.
 * @architectural-layer Services
 * @related-files [packages/tool-runtime/src/tool_registry.ts, packages/tool-runtime/src/tool_schemas.ts]
 */

import { assertEquals } from "@std/assert";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";
import { MemoryType, ToolName } from "@exaix/core";
import type { IApplicationContext, IMemoryService } from "@exaix/core/types";
import type { IMemorySearchResult } from "@exaix/schemas/memory_bank.ts";

const PORTAL_ALIAS = "test-portal";

function makeMockMemoryService(
  results: IMemorySearchResult[],
  captured: { query?: string; options?: { portal?: string; limit?: number } } = {},
): IMemoryService {
  return {
    getProjects: () => Promise.resolve([]),
    getProjectMemory: () => Promise.resolve(null),
    getGlobalMemory: () => Promise.resolve(null),
    getExecutionByTraceId: () => Promise.resolve(null),
    getExecutionHistory: () => Promise.resolve([]),
    search: (query, options) => {
      captured.query = query;
      captured.options = options;
      return Promise.resolve(results);
    },
    listPending: () => Promise.resolve([]),
    getPending: () => Promise.resolve(null),
    approvePending: () => Promise.resolve(),
    rejectPending: () => Promise.resolve(),
  };
}

function makeContext(
  config: ReturnType<typeof createMockConfig>,
  memory: IMemoryService,
): IApplicationContext {
  return {
    memory,
    config: { get: () => config, getAll: () => config },
  } as IApplicationContext;
}

function makePortalConfig(dir: string): ReturnType<typeof createMockConfig> {
  return createMockConfig(dir, {
    portals: [{
      alias: PORTAL_ALIAS,
      target_path: dir,
      default_branch: "main",
      agents_allowed: ["*"],
      operations: [],
    }],
  });
}

Deno.test("[ToolRegistry] search_memory is registered", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-searchmem-registered-" });
  try {
    const registry = new ToolRegistry({ config: makePortalConfig(dir), baseDir: dir });
    const names = registry.getTools().map((t) => t.name);
    assertEquals(names.includes(ToolName.SEARCH_MEMORY), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] search_memory scopes to the current portal and ignores a caller-supplied portal", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-searchmem-scope-" });
  try {
    const results: IMemorySearchResult[] = [{ type: MemoryType.LEARNING, title: "t", summary: "s" }];
    const captured: { query?: string; options?: { portal?: string; limit?: number } } = {};
    const config = makePortalConfig(dir);
    const context = makeContext(config, makeMockMemoryService(results, captured));
    const registry = new ToolRegistry({ config, baseDir: dir, context });

    const result = await registry.execute(ToolName.SEARCH_MEMORY, {
      query: "auth",
      portal: "some-other-portal",
    });

    assertEquals(result.success, true);
    assertEquals(result.data, JSON.parse(JSON.stringify(results)));
    assertEquals(captured.query, "auth");
    assertEquals(captured.options?.portal, PORTAL_ALIAS);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] search_memory forwards an explicit limit", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-searchmem-limit-" });
  try {
    const captured: { query?: string; options?: { portal?: string; limit?: number } } = {};
    const config = makePortalConfig(dir);
    const context = makeContext(config, makeMockMemoryService([], captured));
    const registry = new ToolRegistry({ config, baseDir: dir, context });

    await registry.execute(ToolName.SEARCH_MEMORY, { query: "auth", limit: 3 });

    assertEquals(captured.options?.limit, 3);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ToolRegistry] search_memory errors gracefully when no memory service is configured", async () => {
  const dir = await Deno.makeTempDir({ prefix: "tool-searchmem-noservice-" });
  try {
    const registry = new ToolRegistry({ config: makePortalConfig(dir), baseDir: dir });

    const result = await registry.execute(ToolName.SEARCH_MEMORY, { query: "auth" });
    assertEquals(result.success, false);
    assertEquals(typeof result.error, "string");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
