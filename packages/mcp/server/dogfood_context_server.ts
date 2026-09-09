/**
 * @module DogfoodContextServer
 * @path packages/mcp/server/dogfood_context_server.ts
 * @description Phase 176 Step 2 — a small, per-launch loopback MCP server exposing
 * exactly three read-only tools (query_relationships, who_depends_on, search_memory) to
 * one spawned dogfood child session, over the official @modelcontextprotocol/server SDK
 * (the same createMcpHandler/McpServer pattern exercised by
 * packages/mcp/tests/fixtures/authenticated_reference_server.ts). Bound explicitly to
 * 127.0.0.1 on an OS-assigned port; every request is authenticated by a random bearer
 * capability, validated by the outer Deno.serve handler BEFORE the request reaches SDK
 * dispatch. This is not the edition-gated full MCP server and not LocalToolDispatcher —
 * a narrow, adversarially-hardened broker for exactly one live child connection at a
 * time. Reads only a cached portal-knowledge snapshot resolved once at start (never
 * triggers analysis/indexing) and scoped memory retrieval; never writes.
 * @architectural-layer MCP
 * @dependencies [@modelcontextprotocol/server, zod, @exaix/portal, @exaix/core, @exaix/memory]
 * @related-files [packages/mcp/tests/fixtures/authenticated_reference_server.ts, packages/portal/knowledge/relationship_query.ts, apps/daemon/src/dogfood_context_service.ts]
 */

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { queryRelationships, type RelationshipEdgeKind, whoDependsOn } from "@exaix/portal/knowledge";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import { ToolName } from "@exaix/core";
import type { IContextQueryCompletedPayload, IContextQueryDeniedPayload } from "@exaix/core/events";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { ContextRecordTool } from "@exaix/schemas/dogfood_context.ts";
import type { IToolParameterSchema, IToolSchema, Opt, Reason } from "@exaix/core/types";

/** Narrow slice of SessionMemoryService.lookupMemories this server depends on — identical
 *  shape to DogfoodContextService's own IDogfoodMemorySource, duplicated here rather than
 *  imported to keep packages/mcp free of a @exaix/session/@exaix/memory import cycle risk. */
export interface IDogfoodContextServerMemorySource {
  lookupMemories(
    query: string,
    tokenCap: number | undefined,
    options: { topK?: number; expandLinks?: boolean } | undefined,
    scope: { portalAlias: string },
  ): Promise<ReadonlyArray<{ title: string; content: string; source?: string; relevance: number }>>;
}

export interface IDogfoodContextServerDeps {
  bearerToken: string;
  connectionId: string;
  parentTraceId: string;
  childTraceId: string;
  portalAlias: string;
  /** Cached-only snapshot resolved ONCE before the server starts — this class never calls
   *  getOrAnalyze/analyze. `undefined` means no cached knowledge is available yet. */
  knowledge: IPortalKnowledge | undefined;
  memory: IDogfoodContextServerMemorySource;
  now(): Date;
  expiresAt: Date;
  /** Max characters accepted in a search_memory `query` argument. */
  queryChars: number;
  /** Default/ceiling for search_memory's `limit` when the caller omits it. */
  memoryTopKDefault: number;
  maxQueryCalls: number;
  maxQueryTokens: number;
  maxResponseBytes: number;
  maxRequestBytes: number;
  logger?: Opt<IEventLogger, Reason.OptionalDependency>;
}

export interface IDogfoodContextServerHandle {
  readonly url: string;
  readonly tools: readonly ContextRecordTool[];
  close(reason: string): Promise<void>;
}

/** Pre-digest shape of one granted tool definition — internal only. */
interface IDogfoodToolDefinitionEntry {
  name: string;
  description: string;
  inputSchema: IToolSchema;
  outputSchema: IToolParameterSchema;
}

type DogfoodContextHttpResponse = Response;
type DogfoodContextHttpResponsePromise = Promise<DogfoodContextHttpResponse>;

const ALLOWED_HTTP_METHODS = new Set(["GET", "POST", "DELETE"]);
const RELATIONSHIP_EDGE_KINDS = ["layer_contains_file", "file_imports_file_internal"] as const;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Drops trailing array entries until the JSON-serialized result fits maxBytes; never
 *  splits a single entry. */
function capArrayToByteBudget<T>(items: readonly T[], maxBytes: number): { items: T[]; truncated: boolean } {
  let count = items.length;
  while (count > 0 && new TextEncoder().encode(JSON.stringify(items.slice(0, count))).length > maxBytes) {
    count--;
  }
  return { items: items.slice(0, count) as T[], truncated: count < items.length };
}

const QUERY_RELATIONSHIPS_INPUT_SCHEMA: IToolSchema = {
  type: "object",
  properties: {
    from: { type: "string", description: "A layer name or portal-relative file path to list outgoing edges from" },
    kind: { type: "string", enum: [...RELATIONSHIP_EDGE_KINDS], description: "Optional edge-kind filter" },
  },
  required: ["from"],
};

const WHO_DEPENDS_ON_INPUT_SCHEMA: IToolSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "A portal-relative file path to find dependents of" },
  },
  required: ["path"],
};

const SEARCH_MEMORY_INPUT_SCHEMA: IToolSchema = {
  type: "object",
  properties: {
    query: { type: "string", description: "Free-text search query" },
    limit: { type: "number", description: "Maximum number of results to return" },
  },
  required: ["query"],
};

const EDGE_ARRAY_OUTPUT_SCHEMA: IToolParameterSchema = {
  type: "array",
  items: {
    type: "object",
    properties: { from: { type: "string" }, to: { type: "string" }, kind: { type: "string" } },
  },
};

const MEMORY_ARRAY_OUTPUT_SCHEMA: IToolParameterSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      source: { type: "string" },
      relevance: { type: "number" },
    },
  },
};

/** Starts a per-launch DogfoodContextServer and returns its bound endpoint, the exact
 *  three granted tool definitions, and a close handle. The only export of this module
 *  consumers should use — the class itself stays internal. */
export function startDogfoodContextServer(
  deps: IDogfoodContextServerDeps,
  port: number = 0,
): Promise<IDogfoodContextServerHandle> {
  return new DogfoodContextServer(deps).start(port);
}

/** Daemon-owned, per-launch MCP broker; one instance per child connection, revoked by
 *  close(). @visible */
class DogfoodContextServer {
  private readonly deps: IDogfoodContextServerDeps;
  private readonly logger?: IEventLogger;
  private httpServer?: Deno.HttpServer;
  private mcpHandler?: { fetch(req: Request): DogfoodContextHttpResponsePromise; close(): Promise<void> };
  private revoked = false;
  private inFlight = false;
  private callCount = 0;
  private cumulativeOutputChars = 0;

  constructor(deps: IDogfoodContextServerDeps) {
    this.deps = deps;
    this.logger = deps.logger;
  }

  /** Starts listening on 127.0.0.1:0 (or the given port) and returns the bound endpoint
   *  plus the exact three granted tool definitions for capture in the caller's record. */
  async start(port: number = 0): Promise<IDogfoodContextServerHandle> {
    const tools = await this.buildToolDefinitions();
    this.mcpHandler = createMcpHandler(() => this.buildMcpServer());

    this.httpServer = Deno.serve({ hostname: "127.0.0.1", port, onListen: () => {} }, (req) => this.handle(req));
    const { port: boundPort } = this.httpServer.addr as Deno.NetAddr;
    const url = `http://127.0.0.1:${boundPort}/mcp`;

    return {
      url,
      tools,
      close: (reason: string) => this.close(reason),
    };
  }

  private async close(_reason: string): Promise<void> {
    this.revoked = true;
    if (this.mcpHandler) await this.mcpHandler.close();
    if (this.httpServer) await this.httpServer.shutdown();
  }

  private async buildToolDefinitions(): Promise<ContextRecordTool[]> {
    const entries: IDogfoodToolDefinitionEntry[] = [
      {
        name: ToolName.QUERY_RELATIONSHIPS,
        description:
          "List relationship edges leading forward from a layer name or file path in the bound portal's cached knowledge graph.",
        inputSchema: QUERY_RELATIONSHIPS_INPUT_SCHEMA,
        outputSchema: EDGE_ARRAY_OUTPUT_SCHEMA,
      },
      {
        name: ToolName.WHO_DEPENDS_ON,
        description: "List relationship edges pointing into a file path in the bound portal's cached knowledge graph.",
        inputSchema: WHO_DEPENDS_ON_INPUT_SCHEMA,
        outputSchema: EDGE_ARRAY_OUTPUT_SCHEMA,
      },
      {
        name: ToolName.SEARCH_MEMORY,
        description: "Search project and global memory scoped to the bound portal.",
        inputSchema: SEARCH_MEMORY_INPUT_SCHEMA,
        outputSchema: MEMORY_ARRAY_OUTPUT_SCHEMA,
      },
    ];
    const withDigests: ContextRecordTool[] = [];
    for (const entry of entries) {
      // Round-trips through JSON so the plain-object result genuinely satisfies
      // ContextRecordTool's open-map schema fields, not merely a cast.
      const inputSchema = JSON.parse(JSON.stringify(entry.inputSchema));
      const outputSchema = JSON.parse(JSON.stringify(entry.outputSchema));
      const schemaDigest = await sha256Hex(JSON.stringify({ input: inputSchema, output: outputSchema }));
      withDigests.push({ name: entry.name, description: entry.description, inputSchema, outputSchema, schemaDigest });
    }
    return withDigests;
  }

  private buildMcpServer(): McpServer {
    const server = new McpServer({ name: "exaix-dogfood-context-server", version: "1.0.0" });

    server.registerTool(
      ToolName.QUERY_RELATIONSHIPS,
      {
        description: "List relationship edges leading forward from a layer name or file path.",
        inputSchema: z.object({
          from: z.string().min(1),
          kind: z.enum(RELATIONSHIP_EDGE_KINDS).optional(),
        }),
      },
      (args) => this.runToolCall(() => this.handleQueryRelationships(args.from, args.kind)),
    );

    server.registerTool(
      ToolName.WHO_DEPENDS_ON,
      {
        description: "List relationship edges pointing into a file path.",
        inputSchema: z.object({ path: z.string().min(1) }),
      },
      (args) => this.runToolCall(() => this.handleWhoDependsOn(args.path)),
    );

    server.registerTool(
      ToolName.SEARCH_MEMORY,
      {
        description: "Search project and global memory scoped to the bound portal.",
        inputSchema: z.object({
          query: z.string().min(1).max(this.deps.queryChars),
          limit: z.number().int().positive().optional(),
        }),
      },
      (args) => this.runToolCall(() => this.handleSearchMemory(args.query, args.limit)),
    );

    return server;
  }

  /** Shared gate every tool handler runs through: single-in-flight, expiry, and
   *  call/token-budget enforcement — independent of which of the three tools was called. */
  private async runToolCall(
    run: () => Promise<{ content: Array<{ type: "text"; text: string }> }>,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
    if (this.inFlight) {
      await this.emitDenied("concurrent_call_rejected");
      return {
        content: [{ type: "text", text: "denied: only one in-flight call is permitted per connection" }],
        isError: true,
      };
    }
    if (this.deps.now().getTime() > this.deps.expiresAt.getTime()) {
      await this.emitDenied("expired");
      return { content: [{ type: "text", text: "denied: connection has expired" }], isError: true };
    }
    if (this.callCount >= this.deps.maxQueryCalls) {
      await this.emitDenied("call_limit_exceeded");
      return { content: [{ type: "text", text: "denied: call limit exceeded for this connection" }], isError: true };
    }

    this.inFlight = true;
    this.callCount++;
    const startMs = this.deps.now().getTime();
    try {
      const result = await run();
      const outputChars = result.content.map((c) => c.text).join("").length;
      if (this.cumulativeOutputChars + outputChars > this.deps.maxQueryTokens) {
        await this.emitDenied("token_budget_exceeded");
        return {
          content: [{ type: "text", text: "denied: cumulative output budget exceeded for this connection" }],
          isError: true,
        };
      }
      this.cumulativeOutputChars += outputChars;
      await this.emitCompleted("ok", outputChars, this.deps.now().getTime() - startMs);
      return result;
    } finally {
      this.inFlight = false;
    }
  }

  private handleQueryRelationships(
    from: string,
    kind: Opt<RelationshipEdgeKind, Reason.QueryFilter>,
  ): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    if (!this.deps.knowledge) return Promise.resolve({ content: [{ type: "text", text: "[]" }] });
    const edges = queryRelationships(this.deps.knowledge, from, kind);
    const { items } = capArrayToByteBudget(edges, this.deps.maxResponseBytes);
    return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(items) }] });
  }

  private handleWhoDependsOn(path: string): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    if (!this.deps.knowledge) return Promise.resolve({ content: [{ type: "text", text: "[]" }] });
    const edges = whoDependsOn(this.deps.knowledge, path);
    const { items } = capArrayToByteBudget(edges, this.deps.maxResponseBytes);
    return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(items) }] });
  }

  private async handleSearchMemory(
    query: string,
    limit: Opt<number, Reason.OptionalInput>,
  ): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    const items = await this.deps.memory.lookupMemories(
      query,
      undefined,
      { topK: limit ?? this.deps.memoryTopKDefault, expandLinks: false },
      { portalAlias: this.deps.portalAlias },
    ).catch(() => []);
    const { items: capped } = capArrayToByteBudget(items, this.deps.maxResponseBytes);
    return { content: [{ type: "text", text: JSON.stringify(capped) }] };
  }

  private async emitCompleted(resultCategory: string, outputChars: number, durationMs: number): Promise<void> {
    if (!this.logger) return;
    const payload: IContextQueryCompletedPayload = {
      connection_id: this.deps.connectionId,
      tool: "dogfood_context_server",
      result_category: resultCategory,
      output_tokens: outputChars,
      duration_ms: durationMs,
    };
    await this.logger.info(
      DomainEventType.ContextQueryCompleted,
      this.deps.connectionId,
      { ...payload },
      this.deps.childTraceId,
    );
  }

  private async emitDenied(reason: string): Promise<void> {
    if (!this.logger) return;
    const payload: IContextQueryDeniedPayload = {
      connection_id: this.deps.connectionId,
      tool: "dogfood_context_server",
      reason,
    };
    await this.logger.info(
      DomainEventType.ContextQueryDenied,
      this.deps.connectionId,
      { ...payload },
      this.deps.childTraceId,
    );
  }

  /** Outer HTTP gate: method allowlist, DNS-rebinding guards (Origin/Host), size cap,
   *  and bearer auth — all validated BEFORE the request reaches the SDK's own dispatch. */
  private async handle(req: Request): DogfoodContextHttpResponsePromise {
    if (!ALLOWED_HTTP_METHODS.has(req.method)) {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (req.headers.get("origin") !== null) {
      await this.emitDenied("hostile_origin");
      return new Response("Forbidden", { status: 403 });
    }
    const host = req.headers.get("host") ?? "";
    if (!host.startsWith("127.0.0.1:") && host !== "127.0.0.1") {
      await this.emitDenied("hostile_host");
      return new Response("Forbidden", { status: 403 });
    }
    const contentLength = req.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > this.deps.maxRequestBytes) {
      await this.emitDenied("request_too_large");
      return new Response("Payload Too Large", { status: 413 });
    }
    if (this.revoked) {
      await this.emitDenied("revoked");
      return new Response("Unauthorized", { status: 401 });
    }
    if (req.headers.get("authorization") !== `Bearer ${this.deps.bearerToken}`) {
      await this.emitDenied("bad_credential");
      return new Response("Unauthorized", { status: 401 });
    }
    return await this.mcpHandler!.fetch(req);
  }
}
