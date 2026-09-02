/**
 * @module RememberFactToolTest
 * @path packages/memory/tests/scratchpad/remember_fact_tool_test.ts
 * @description Invokes `remember_fact` through a real ToolRegistry: the entry is scoped to the
 * registry's own traceId (never a trace_id supplied in the tool-call params), and the
 * per-execution entry-count cap is enforced with a clear IToolResult error.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";

import { ToolRegistry } from "@exaix/tool-runtime";
import { DEFAULT_SCRATCHPAD_MAX_ENTRIES_PER_EXECUTION, ToolName } from "@exaix/core";
import { ExecutionMemoryStore } from "@exaix/core/execution-memory";
import { createMockConfig, getMemoryExecutionDir, initTestDbService } from "@exaix/testing";
import type { IApplicationContext, IDatabaseService, IDisplayService } from "@exaix/core/types";
import { createGitServiceStub, createProviderStub } from "@exaix/testing/helpers/stub_factories.ts";

const REGISTRY_DEFAULT_TRACE_ID = "tool-registry";

function scratchpadPath(tempDir: string, traceId: string): string {
  return join(getMemoryExecutionDir(tempDir), traceId, "scratchpad.jsonl");
}

/** Only .executionMemoryStore./.config. are read by remember_fact; the rest of IApplicationContext is
 *  stubbed to satisfy the interface, matching flow_runner.ts's established stubbing idiom. */
function makeContext(
  config: ReturnType<typeof createMockConfig>,
  executionMemoryStore: ExecutionMemoryStore,
): IApplicationContext {
  return {
    executionMemoryStore,
    config: {
      get: () => config,
      getAll: () => config,
      getConfigPath: () => "",
      reload: () => config,
      getSchemaVersion: () => "1.0.0",
      getPortals: () => [],
      getPortal: () => undefined,
      addPortal: () => Promise.resolve(),
      removePortal: () => Promise.resolve(),
    },
    db: {} as IDatabaseService,
    provider: createProviderStub(),
    git: createGitServiceStub(),
    display: {} as IDisplayService,
  } as IApplicationContext;
}

Deno.test("remember_fact through a real ToolRegistry writes to the registry traceId, ignoring a params trace_id", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const executionMemoryStore = new ExecutionMemoryStore(config);
    const toolConfig = createMockConfig(config.system.root);
    const registry = new ToolRegistry({
      config: toolConfig,
      baseDir: config.system.root,
      context: makeContext(toolConfig, executionMemoryStore),
    });

    const result = await registry.execute(ToolName.REMEMBER_FACT, {
      content: "agent noticed a flaky retry path",
      trace_id: "attacker-supplied-trace",
    });

    assertEquals(result.success, true);
    const entryId = (result.data as { entry_id: string }).entry_id;
    assertExists(entryId);

    const entries = await executionMemoryStore.readNotes(REGISTRY_DEFAULT_TRACE_ID);
    assertEquals(entries.length, 1);
    assertEquals(entries[0].content, "agent noticed a flaky retry path");

    assertEquals(await exists(scratchpadPath(config.system.root, REGISTRY_DEFAULT_TRACE_ID)), true);
    assertEquals(
      await exists(scratchpadPath(config.system.root, "attacker-supplied-trace")),
      false,
      "a trace_id in the tool-call params must never be honoured",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("remember_fact forwards tags through the registry to the scratchpad entry", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const executionMemoryStore = new ExecutionMemoryStore(config);
    const toolConfig = createMockConfig(config.system.root);
    const registry = new ToolRegistry({
      config: toolConfig,
      baseDir: config.system.root,
      context: makeContext(toolConfig, executionMemoryStore),
    });

    const result = await registry.execute(ToolName.REMEMBER_FACT, {
      content: "tagged note",
      tags: ["perf", "flaky"],
    });

    assertEquals(result.success, true);
    const entries = await executionMemoryStore.readNotes(REGISTRY_DEFAULT_TRACE_ID);
    assertEquals(entries.length, 1);
    assertEquals(entries[0].tags, ["perf", "flaky"]);
  } finally {
    await cleanup();
  }
});

Deno.test("remember_fact enforces the per-execution entry-count cap with a clear IToolResult error", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const executionMemoryStore = new ExecutionMemoryStore(config);
    const toolConfig = createMockConfig(config.system.root);
    const registry = new ToolRegistry({
      config: toolConfig,
      baseDir: config.system.root,
      context: makeContext(toolConfig, executionMemoryStore),
    });

    for (let i = 0; i < DEFAULT_SCRATCHPAD_MAX_ENTRIES_PER_EXECUTION; i++) {
      const fill = await executionMemoryStore.appendNote(REGISTRY_DEFAULT_TRACE_ID, `filler ${i}`);
      assertEquals(fill.success, true);
    }

    const result = await registry.execute(ToolName.REMEMBER_FACT, {
      content: "one entry too many",
    });

    assertEquals(result.success, false);
    assertEquals(
      result.error,
      `scratchpad full: max ${DEFAULT_SCRATCHPAD_MAX_ENTRIES_PER_EXECUTION} entries reached for this execution`,
    );
    const entries = await executionMemoryStore.readNotes(REGISTRY_DEFAULT_TRACE_ID);
    assertEquals(entries.length, DEFAULT_SCRATCHPAD_MAX_ENTRIES_PER_EXECUTION, "over-cap call must not append");
  } finally {
    await cleanup();
  }
});
