/**
 * @module LocalToolDispatcherTest
 * @path packages/mcp/tests/local_tool_dispatcher_test.ts
 * @related-files []
 * @architectural-layer MCP
 * @description Unit tests for LocalToolDispatcher tool routing and canonical Map-based construction.
 */
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { LocalToolDispatcher } from "@exaix/mcp/server";
import { appendToolChoiceHint, McpToolName, TOOL_MANIFEST } from "@exaix/mcp";
import { TOOL_ALIASES, ToolCallEntryPoint } from "@exaix/core";
import { DomainEventType, type IToolAliasRewrittenPayload } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { ToolHandler } from "@exaix/mcp/server";
import type { IApplicationContext } from "@exaix/core/types";
import type { JSONValue } from "@exaix/core/types";
import type { MCPToolResponse } from "@exaix/schemas/mcp.ts";
import { createStubContext, initTestDbService } from "@exaix/testing";

type IToolDefinition = ReturnType<ToolHandler["getToolDefinition"]>;

const mockContext: IApplicationContext = createStubContext({
  db: {
    logActivity: (
      _actor: string,
      _action: string,
      _target: string | null,
      _payload: Record<string, JSONValue>,
      _traceId?: string,
      _agentRole?: string | null,
    ) => {},
    waitForFlush: () => Promise.resolve(),
    queryActivity: () => Promise.resolve([]),
    getActivitiesByTrace: () => [],
    getActivitiesByTraceSafe: () => Promise.resolve([]),
    getActivitiesByActionType: () => [],
    getActivitiesByActionTypeSafe: () => Promise.resolve([]),
    getRecentActivity: () => Promise.resolve([]),
    insertToolConfirmationRequest: () => Promise.resolve(),
    writeToolConfirmationDecision: () => Promise.resolve(),
    getToolConfirmationDecision: () => Promise.resolve(null),
    listPendingToolConfirmations: () => Promise.resolve([]),
    close: () => Promise.resolve(),
    preparedGet: () => Promise.resolve(null),
    preparedAll: () => Promise.resolve([]),
    preparedRun: () => Promise.resolve({}),
  },
});

class PassingTool extends ToolHandler {
  constructor() {
    super(mockContext);
  }
  async execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    await Promise.resolve();
    return { content: [{ type: "text", text: "success_result" }] };
  }
  getToolDefinition(): IToolDefinition {
    return { name: McpToolName.READ_FILE, description: "", inputSchema: { type: "object", properties: {} } };
  }
}

class FailingTool extends ToolHandler {
  constructor() {
    super(mockContext);
  }
  async execute(_args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    await Promise.resolve();
    throw new Error("execution error");
  }
  getToolDefinition(): IToolDefinition {
    return { name: McpToolName.WRITE_FILE, description: "", inputSchema: { type: "object", properties: {} } };
  }
}

Deno.test("LocalToolDispatcher - calls existing MCP tools correctly", async () => {
  const handlers = [new PassingTool()];
  const client = new LocalToolDispatcher(mockContext, handlers);

  const result = await client.callTool(McpToolName.READ_FILE, {});
  assertEquals(result, "success_result");
});

Deno.test("LocalToolDispatcher - tool not found propagating error", async () => {
  const client = new LocalToolDispatcher(mockContext, []);

  await assertRejects(
    () => client.callTool(McpToolName.READ_FILE, {}),
    Error,
    "not found",
  );
});

Deno.test("LocalToolDispatcher - tool execution errors are propagated", async () => {
  const client = new LocalToolDispatcher(mockContext, [new FailingTool()]);

  await assertRejects(
    () => client.callTool(McpToolName.WRITE_FILE, {}),
    Error,
    "execution error",
  );
});

Deno.test("LocalToolDispatcher - accepts Map<McpToolName, ToolHandler> as canonical input", async () => {
  const handlerMap = new Map<McpToolName, ToolHandler>([
    [McpToolName.READ_FILE, new PassingTool()],
  ]);
  const client = new LocalToolDispatcher(mockContext, handlerMap);

  const result = await client.callTool(McpToolName.READ_FILE, {});
  assertEquals(result, "success_result");
});

Deno.test("LocalToolDispatcher - getAvailableToolNames returns all registered tool names", () => {
  const handlerMap = new Map<McpToolName, ToolHandler>([
    [McpToolName.READ_FILE, new PassingTool()],
    [McpToolName.WRITE_FILE, new FailingTool()],
  ]);
  const client = new LocalToolDispatcher(mockContext, handlerMap);

  const names = client.getAvailableToolNames();
  assertExists(names);
  assertEquals(names.sort(), [McpToolName.READ_FILE, McpToolName.WRITE_FILE].sort());
});

Deno.test("LocalToolDispatcher - getAvailableToolNames returns empty for empty client", () => {
  const client = new LocalToolDispatcher(mockContext, []);
  assertEquals(client.getAvailableToolNames(), []);
});

// IToolManifestResolver

Deno.test("LocalToolDispatcher - requiresHumanApproval returns true for exaix_create_request", () => {
  const client = new LocalToolDispatcher(mockContext, []);
  assertEquals(client.requiresHumanApproval(McpToolName.CREATE_REQUEST), true);
});

Deno.test("LocalToolDispatcher - requiresHumanApproval returns true for exaix_approve_plan", () => {
  const client = new LocalToolDispatcher(mockContext, []);
  assertEquals(client.requiresHumanApproval(McpToolName.APPROVE_PLAN), true);
});

Deno.test("LocalToolDispatcher - requiresHumanApproval returns false for read_file", () => {
  const client = new LocalToolDispatcher(mockContext, []);
  assertEquals(client.requiresHumanApproval(McpToolName.READ_FILE), false);
});

Deno.test("LocalToolDispatcher - requiresHumanApproval returns false for unknown tool name", () => {
  const client = new LocalToolDispatcher(mockContext, []);
  assertEquals(client.requiresHumanApproval("unknown_tool" as McpToolName), false);
});

Deno.test("LocalToolDispatcher - getToolDefinitions appends the manifest hint to a tool's description", () => {
  class StubPatchFileTool extends ToolHandler {
    constructor() {
      super(mockContext);
    }
    execute(): Promise<MCPToolResponse> {
      return Promise.resolve({ content: [] });
    }
    getToolDefinition(): IToolDefinition {
      return {
        name: McpToolName.PATCH_FILE,
        description: "Base description.",
        inputSchema: { type: "object", properties: {} },
      };
    }
  }
  const client = new LocalToolDispatcher(mockContext, [new StubPatchFileTool()]);
  const [definition] = client.getToolDefinitions([McpToolName.PATCH_FILE]);
  assertEquals(definition.description, appendToolChoiceHint(McpToolName.PATCH_FILE, "Base description."));
});

Deno.test("LocalToolDispatcher - Map construction: tool not in map returns not found error", async () => {
  const handlerMap = new Map<McpToolName, ToolHandler>([
    [McpToolName.READ_FILE, new PassingTool()],
  ]);
  const client = new LocalToolDispatcher(mockContext, handlerMap);

  await assertRejects(
    () => client.callTool(McpToolName.LIST_DIRECTORY, {}),
    Error,
    "not found",
  );
});

class RecordingTool extends ToolHandler {
  readonly calls: Array<Record<string, JSONValue>> = [];
  constructor(private readonly toolName: string, private readonly properties: Record<string, JSONValue>) {
    super(mockContext);
  }
  execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    this.calls.push(args);
    return Promise.resolve({ content: [{ type: "text", text: `ran:${this.toolName}` }] });
  }
  getToolDefinition(): IToolDefinition {
    return { name: this.toolName, description: "", inputSchema: { type: "object", properties: this.properties } };
  }
}

async function withJournal(
  fn: (
    logger: EventLogger,
    rewrites: () => Promise<IToolAliasRewrittenPayload[]>,
    rewriteRows: () => Promise<Array<{ traceId: string; payload: IToolAliasRewrittenPayload }>>,
    attributionGroups: () => Promise<Array<{ provider: string | null; model: string | null; count: number }>>,
  ) => Promise<void>,
) {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    await fn(logger, async () => {
      await db.waitForFlush();
      return db.getActivitiesByActionType(DomainEventType.ToolAliasRewritten)
        .map((row) => JSON.parse(row.payload) as IToolAliasRewrittenPayload);
    }, async () => {
      await db.waitForFlush();
      return db.getActivitiesByActionType(DomainEventType.ToolAliasRewritten).map((row) => ({
        traceId: row.trace_id,
        payload: JSON.parse(row.payload) as IToolAliasRewrittenPayload,
      }));
    }, async () => {
      await db.waitForFlush();
      return await db.preparedAll<{ provider: string | null; model: string | null; count: number }>(
        `SELECT json_extract(payload, '$.provider') AS provider,
          json_extract(payload, '$.model') AS model, COUNT(*) AS count
        FROM activity WHERE action_type = ? GROUP BY provider, model ORDER BY provider, model`,
        [DomainEventType.ToolAliasRewritten],
      );
    });
  } finally {
    await cleanup();
  }
}

Deno.test("[mcp][local] alias event retains the caller trace and model response identity", async () => {
  await withJournal(async (logger, _rewrites, rewriteRows) => {
    const read = new RecordingTool(McpToolName.READ_FILE, { path: { type: "string" } });
    const client = new LocalToolDispatcher(mockContext, [read], logger);

    await client.callTool("Read" as McpToolName, { file_path: "a.ts" }, {
      traceId: "phase201-parent-trace",
      provider: "fixture-provider",
      model: "fixture-model",
    });

    assertEquals(await rewriteRows(), [{
      traceId: "phase201-parent-trace",
      payload: {
        requestedName: "Read",
        canonicalName: McpToolName.READ_FILE,
        renamedParams: [{ from: "file_path", to: "path" }],
        droppedParams: [],
        entryPoint: ToolCallEntryPoint.MCP,
        provider: "fixture-provider",
        model: "fixture-model",
      },
    }]);
  });
});

Deno.test("[alias-attribution] journal query groups actual producers and keeps external identity unknown", async () => {
  await withJournal(async (logger, _rewrites, _rewriteRows, attributionGroups) => {
    const read = new RecordingTool(McpToolName.READ_FILE, { path: { type: "string" } });
    const client = new LocalToolDispatcher(mockContext, [read], logger);
    await client.callTool("Read" as McpToolName, { file_path: "a.ts" }, {
      traceId: "shared-request-trace",
      provider: "provider-a",
      model: "model-a",
    });
    await client.callTool("Read" as McpToolName, { file_path: "b.ts" }, {
      traceId: "shared-request-trace",
      provider: "provider-b",
      model: "model-b",
    });
    await client.callTool("Read" as McpToolName, { file_path: "external.ts" });

    assertEquals(await attributionGroups(), [
      { provider: null, model: null, count: 1 },
      { provider: "provider-a", model: "model-a", count: 1 },
      { provider: "provider-b", model: "model-b", count: 1 },
    ]);
  });
});

Deno.test("[mcp][local] a general-purpose alias executes the canonical handler and emits one rewrite with entryPoint mcp", async () => {
  await withJournal(async (logger, rewrites) => {
    const read = new RecordingTool(McpToolName.READ_FILE, { path: { type: "string" }, portal: { type: "string" } });
    const client = new LocalToolDispatcher(mockContext, [read], logger);

    assertEquals(await client.callTool("Read" as McpToolName, { portal: "p", file_path: "a.ts" }), "ran:read_file");
    assertEquals(read.calls, [{ portal: "p", path: "a.ts" }]);
    assertEquals(await rewrites(), [{
      requestedName: "Read",
      canonicalName: McpToolName.READ_FILE,
      renamedParams: [{ from: "file_path", to: "path" }],
      droppedParams: [],
      entryPoint: ToolCallEntryPoint.MCP,
    }]);
  });
});

Deno.test("[mcp][local] query_symbols {query} and {name} reach the handler as {name}; the canonical key wins a conflict", async () => {
  await withJournal(async (logger, rewrites) => {
    const symbols = new RecordingTool(McpToolName.PORTAL_SYMBOLS, {
      portal: { type: "string" },
      name: { type: "string" },
      kind: { type: "string" },
    });
    const client = new LocalToolDispatcher(mockContext, [symbols], logger);

    await client.callTool(McpToolName.PORTAL_SYMBOLS, { portal: "p", query: "greet" });
    await client.callTool(McpToolName.PORTAL_SYMBOLS, { portal: "p", name: "greet" });
    await client.callTool(McpToolName.PORTAL_SYMBOLS, { portal: "p", query: "loser", name: "greet" });

    assertEquals(symbols.calls, [
      { portal: "p", name: "greet" },
      { portal: "p", name: "greet" },
      { portal: "p", name: "greet" },
    ]);
    const events = await rewrites();
    assertEquals(events.length, 2);
    assertEquals(events[1].droppedParams, ["query"]);
  });
});

Deno.test("[mcp][local] retired native names and native case/whitespace variants never reach a handler", async () => {
  const symbols = new RecordingTool(McpToolName.PORTAL_SYMBOLS, { name: { type: "string" } });
  const client = new LocalToolDispatcher(mockContext, [symbols]);
  for (const name of ["exaix_portal_symbols", "list_symbols", " QUERY_SYMBOLS ", "Query_Symbols"]) {
    await assertRejects(() => client.callTool(name as McpToolName, {}), Error, "not found");
  }
  assertEquals(symbols.calls, []);
});

Deno.test("[mcp][security] an alias resolves to the same approval decision as its canonical tool; an approval tool's variant never executes", async () => {
  const client = new LocalToolDispatcher(mockContext, [new RecordingTool(McpToolName.CREATE_REQUEST, {})]);
  for (const [alias, { canonical }] of Object.entries(TOOL_ALIASES)) {
    if (!TOOL_MANIFEST.some((entry) => entry.name === canonical)) continue;
    assertEquals(
      client.requiresHumanApproval(alias as McpToolName),
      client.requiresHumanApproval(canonical as McpToolName),
      alias,
    );
  }
  assertEquals(client.requiresHumanApproval(McpToolName.CREATE_REQUEST), true);
  await assertRejects(() => client.callTool(" EXAIX_CREATE_REQUEST " as McpToolName, {}), Error, "not found");
});

Deno.test("[mcp][local] getToolDefinitions resolves a general-purpose alias to the canonical definition", () => {
  const client = new LocalToolDispatcher(mockContext, [new RecordingTool(McpToolName.READ_FILE, {})]);
  assertEquals(client.getToolDefinitions(["Read" as McpToolName]).map((d) => d.name), [McpToolName.READ_FILE]);
  assertEquals(client.getToolDefinitions(["exaix_portal_symbols" as McpToolName]), []);
});
