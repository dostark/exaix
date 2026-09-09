/**
 * @module DogfoodContextService
 * @path apps/daemon/src/dogfood_context_service.ts
 * @description Daemon-owned implementation of IDogfoodContextPort: composes a bounded,
 * scoped portal-knowledge + memory supplement onto the original prompt, redacts and
 * captures an immutable ContextRecord before returning the handle a launch consumer
 * sends to the child. Config-free at the package boundary — the trusted portal alias and
 * config are supplied at construction by apps/daemon/main.ts, never from `prepare`'s input.
 * @architectural-layer Application
 * @dependencies [@exaix/core, @exaix/schemas, @exaix/session]
 * @related-files [packages/core/src/types/i_dogfood_context.ts, packages/session/src/context_record_store.ts, packages/schemas/src/dogfood_context.ts]
 */

import { fitContextItems, type ITokenizer, redactKnownSecrets, stripTerminalControlBytes } from "@exaix/core/func";
import { ContextResultStatus, DOGFOOD_CONTEXT_BEARER_ENV_VAR } from "@exaix/core";
import type { ContextConnectionCloseReason } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type {
  IContextCapturedPayload,
  IContextCaptureFailedPayload,
  IContextConnectionClosedPayload,
} from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type {
  IDogfoodContextConnection,
  IDogfoodContextHandle,
  IDogfoodContextInput,
  IDogfoodContextPort,
  IPortalKnowledgeService,
  IScoredContextResult,
  Opt,
  Reason,
} from "@exaix/core/types";
import {
  CONTEXT_RECORD_SCHEMA_VERSION,
  type ContextRecord,
  type ContextRecordSection,
} from "@exaix/schemas/dogfood_context.ts";
import type { IMemoryRetrievalScope, MemoryItem, SessionMemoryConfig } from "@exaix/memory";
import { startDogfoodContextServer } from "@exaix/mcp/server";
import type { IDogfoodContextServerDeps, IDogfoodContextServerHandle } from "@exaix/mcp/server";

/** Narrow slice of SessionMemoryService this service depends on. */
export interface IDogfoodMemorySource {
  lookupMemories(
    query: string,
    tokenCap: number | undefined,
    options: Partial<SessionMemoryConfig> | undefined,
    scope: IMemoryRetrievalScope,
  ): Promise<MemoryItem[]>;
}

/** Narrow slice of ContextRecordStore this service depends on. */
export interface IDogfoodContextRecordWriter {
  save(record: ContextRecord): Promise<void>;
}

export interface IDogfoodContextServiceConfig {
  portalTopK: number;
  memoryTopK: number;
  portalTokens: number;
  memoryTokens: number;
  maxInputTokens: number;
  outputReserveTokens: number;
  /** Max characters accepted in the child's search_memory `query` argument. */
  queryChars: number;
  maxQueryCalls: number;
  maxQueryTokens: number;
  maxResponseBytes: number;
  maxRequestBytes: number;
  /** Wall-clock lifetime of the live MCP connection, independent of explicit close(). */
  connectionTtlMs: number;
}

/** Injectable seam over startDogfoodContextServer — defaults to the real implementation;
 *  overridden in tests to simulate an endpoint-start failure without a real listener. */
export type IStartDogfoodContextServer = (
  deps: IDogfoodContextServerDeps,
  port?: number,
) => Promise<IDogfoodContextServerHandle>;

/** The narrow slice of IPortalKnowledgeService this service depends on. */
export type IDogfoodPortalKnowledgeSource = Pick<IPortalKnowledgeService, "queryContext" | "loadCachedKnowledge">;

export interface IDogfoodContextServiceDeps {
  /** Trusted, daemon-resolved portal alias — never taken from `prepare`'s input. */
  portalAlias: string;
  portalKnowledge: IDogfoodPortalKnowledgeSource;
  memory: IDogfoodMemorySource;
  tokenizer: ITokenizer;
  recordStore: IDogfoodContextRecordWriter;
  config: IDogfoodContextServiceConfig;
  /** Known configured credential values to redact before send/capture. */
  knownSecrets: readonly string[];
  now(): Date;
  logger?: IEventLogger;
  startServer?: Opt<IStartDogfoodContextServer, Reason.OptionalDependency>;
}

/** Thrown when the per-launch MCP endpoint fails to start — the launch aborts rather than
 *  proceeding without a live connection. */
export class DogfoodContextEndpointStartError extends Error {
  constructor(causeMessage: string) {
    super(`dogfood context MCP endpoint failed to start: ${causeMessage}`);
    this.name = "DogfoodContextEndpointStartError";
  }
}

/** Thrown when the immutable original prompt alone cannot fit the configured input
 *  budget — the step/acceptance criteria are never silently trimmed to make room. */
export class DogfoodContextInputBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DogfoodContextInputBudgetExceededError";
  }
}

/** Thrown when the original objective/acceptance criteria contain a known credential —
 *  the launch aborts rather than silently altering required instructions. */
export class DogfoodContextKnownSecretInPromptError extends Error {
  constructor() {
    super("original prompt contains a known configured credential — aborting rather than redacting silently");
    this.name = "DogfoodContextKnownSecretInPromptError";
  }
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Random 32-byte bearer capability, hex-encoded — minted fresh per connection, never
 *  derived from any persisted or predictable value. */
function generateBearerToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Daemon-owned bounded-context composer and capturer.
 * @visible
 */
export class DogfoodContextService implements IDogfoodContextPort {
  private readonly deps: IDogfoodContextServiceDeps;
  private readonly logger?: IEventLogger;
  private readonly startServer: IStartDogfoodContextServer;
  /** Live server handles keyed by recordId — populated in doPrepare, consumed by close(). */
  private readonly connections = new Map<string, { connectionId: string; handle: IDogfoodContextServerHandle }>();

  constructor(deps: IDogfoodContextServiceDeps) {
    this.deps = deps;
    this.logger = deps.logger;
    this.startServer = deps.startServer ?? startDogfoodContextServer;
  }

  async prepare(
    input: IDogfoodContextInput,
    signal?: Opt<AbortSignal, Reason.CancellationOptional>,
  ): Promise<IDogfoodContextHandle> {
    const startMs = this.deps.now().getTime();
    const recordId = crypto.randomUUID();

    try {
      return await this.doPrepare(input, recordId, signal);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      await this.emitCaptureFailed(input, recordId, normalized, startMs);
      throw error;
    }
  }

  private async doPrepare(
    input: IDogfoodContextInput,
    recordId: string,
    signal: Opt<AbortSignal, Reason.CancellationOptional>,
  ): Promise<IDogfoodContextHandle> {
    const startMs = this.deps.now().getTime();

    const originalContainsSecret = this.containsKnownSecret(input.originalPrompt) ||
      input.acceptanceCriteria.some((c) => this.containsKnownSecret(c));
    if (originalContainsSecret) {
      throw new DogfoodContextKnownSecretInPromptError();
    }

    const effectiveInputLimit = Math.max(0, this.deps.config.maxInputTokens - this.deps.config.outputReserveTokens);
    const [originalPromptTokens] = await this.deps.tokenizer.countTokensBatch([input.originalPrompt], input.model);
    if (originalPromptTokens > effectiveInputLimit) {
      throw new DogfoodContextInputBudgetExceededError(
        `original prompt (${originalPromptTokens} tokens) alone exceeds the effective input budget (${effectiveInputLimit} tokens)`,
      );
    }

    const remainingBudget = effectiveInputLimit - originalPromptTokens;
    const { portalBudget, memoryBudget } = this.splitRemainingBudget(remainingBudget);

    // Two independent sources — one failure never discards the other's successful result.
    const [portalResult, memoryItems] = await Promise.all([
      this.queryPortal(input.queryText, signal),
      this.queryMemory(input.queryText, input.stepId),
    ]);

    const portalTexts = portalResult.status === ContextResultStatus.OK ? portalResult.items.map((i) => i.text) : [];
    const memoryTexts = memoryItems.map((m) => `${m.title}: ${m.content}`);

    const fittedPortal = await fitContextItems(this.deps.tokenizer, input.model, portalTexts, portalBudget);
    const fittedMemory = await fitContextItems(this.deps.tokenizer, input.model, memoryTexts, memoryBudget);

    const supplementParts = [...fittedPortal.selected, ...fittedMemory.selected];
    const rawPrompt = supplementParts.length > 0
      ? `${input.originalPrompt}\n\n---\n\n${supplementParts.join("\n\n---\n\n")}`
      : input.originalPrompt;
    const cleanedPrompt = stripTerminalControlBytes(rawPrompt);
    const { text: promptText } = redactKnownSecrets(cleanedPrompt, this.deps.knownSecrets);

    const [finalTokenCount] = await this.deps.tokenizer.countTokensBatch([promptText], input.model);
    if (finalTokenCount > effectiveInputLimit) {
      throw new DogfoodContextInputBudgetExceededError(
        `assembled prompt (${finalTokenCount} tokens) exceeds the effective input budget (${effectiveInputLimit} tokens)`,
      );
    }

    const sections: ContextRecordSection[] = [
      this.buildSection("portalKnowledgeCrucial", "portalKnowledge", portalBudget, fittedPortal.usedTokens, {
        selectedSourceIds: portalResult.status === ContextResultStatus.OK
          ? portalResult.items.slice(0, fittedPortal.selected.length).map((i) => i.id)
          : [],
        selectedScores: portalResult.status === ContextResultStatus.OK
          ? portalResult.items.slice(0, fittedPortal.selected.length).map((i) => i.score)
          : [],
        unavailableReason: portalResult.status === ContextResultStatus.UNAVAILABLE ? portalResult.reason : undefined,
        truncated: portalTexts.length > fittedPortal.selected.length,
      }),
      this.buildSection("memoryCrucial", "memory", memoryBudget, fittedMemory.usedTokens, {
        selectedSourceIds: memoryItems.slice(0, fittedMemory.selected.length)
          .map((m) => m.source ?? m.title),
        selectedScores: memoryItems.slice(0, fittedMemory.selected.length).map((m) => m.relevance),
        unavailableReason: memoryItems.length === 0 ? "no_hits" : undefined,
        truncated: memoryTexts.length > fittedMemory.selected.length,
      }),
    ];

    const connection = await this.startConnection(input, recordId, signal);

    const record: ContextRecord = {
      schemaVersion: CONTEXT_RECORD_SCHEMA_VERSION,
      recordId,
      executionTraceId: input.executionTraceId,
      parentTraceId: input.parentTraceId,
      stepId: input.stepId,
      sequence: input.sequence,
      turn: input.turn,
      attempt: input.attempt,
      surface: input.surface,
      model: input.model,
      timestamp: this.deps.now().toISOString(),
      originalInputSha256: await sha256Hex(input.originalPrompt),
      promptText,
      promptSha256: await sha256Hex(promptText),
      originalTokenCount: originalPromptTokens,
      finalTokenCount,
      tokenSource: "counted",
      effectiveInputLimit,
      effectiveReserveLimit: this.deps.config.outputReserveTokens,
      sections,
      tools: [...connection.tools],
      visibility: "exaix_submission_only",
      nativePrompt: "unknown",
      nativeTools: "unknown",
      nativeHistory: "unknown",
    };

    // Capture must succeed before child launch — a store failure aborts, it is never a
    // best-effort warning. The just-started endpoint is torn down on a save failure so no
    // connection outlives its (never-captured) record.
    try {
      await this.deps.recordStore.save(record);
    } catch (error) {
      const tracked = this.connections.get(recordId);
      this.connections.delete(recordId);
      await tracked?.handle.close("failed");
      throw error;
    }
    await this.emitCaptured(input, record, this.deps.now().getTime() - startMs);

    return {
      recordId,
      prompt: promptText,
      connectionId: connection.connectionId,
      connection,
    };
  }

  /** Starts the per-launch MCP endpoint over a cached-only portal-knowledge snapshot
   *  (never triggers analysis) and tracks the handle under recordId so close() can revoke
   *  it; a start failure propagates to prepare()'s own ContextCaptureFailed handling. */
  private async startConnection(
    input: IDogfoodContextInput,
    recordId: string,
    signal: Opt<AbortSignal, Reason.CancellationOptional>,
  ): Promise<IDogfoodContextConnection> {
    const connectionId = crypto.randomUUID();
    const bearerToken = generateBearerToken();
    const expiresAt = new Date(this.deps.now().getTime() + this.deps.config.connectionTtlMs);
    const cachedKnowledge = await this.deps.portalKnowledge.loadCachedKnowledge(this.deps.portalAlias);

    let serverHandle: IDogfoodContextServerHandle;
    try {
      serverHandle = await this.startServer({
        bearerToken,
        connectionId,
        parentTraceId: input.parentTraceId,
        childTraceId: input.executionTraceId,
        portalAlias: this.deps.portalAlias,
        knowledge: cachedKnowledge,
        memory: this.deps.memory,
        now: () => this.deps.now(),
        expiresAt,
        queryChars: this.deps.config.queryChars,
        memoryTopKDefault: this.deps.config.memoryTopK,
        maxQueryCalls: this.deps.config.maxQueryCalls,
        maxQueryTokens: this.deps.config.maxQueryTokens,
        maxResponseBytes: this.deps.config.maxResponseBytes,
        maxRequestBytes: this.deps.config.maxRequestBytes,
        logger: this.logger,
      });
    } catch (error) {
      throw new DogfoodContextEndpointStartError(error instanceof Error ? error.message : String(error));
    }
    void signal; // Server startup itself is not cancellable mid-bind; the caller's signal
    // still governs the surrounding portal/memory queries via queryPortal.
    this.connections.set(recordId, { connectionId, handle: serverHandle });
    return {
      connectionId,
      endpoint: serverHandle.url,
      bearerEnvVar: DOGFOOD_CONTEXT_BEARER_ENV_VAR,
      bearerToken,
      expiresAt: expiresAt.toISOString(),
      tools: serverHandle.tools,
    };
  }

  private async emitCaptured(input: IDogfoodContextInput, record: ContextRecord, durationMs: number): Promise<void> {
    if (!this.logger) return;
    const payload: IContextCapturedPayload = {
      record_id: record.recordId,
      parent_trace_id: input.parentTraceId,
      child_trace_id: input.executionTraceId,
      step_id: input.stepId,
      turn: input.turn,
      attempt: input.attempt,
      model: input.model,
      original_token_count: record.originalTokenCount,
      final_token_count: record.finalTokenCount,
      token_source: record.tokenSource,
      duration_ms: durationMs,
    };
    await this.logger.info(
      DomainEventType.ContextCaptured,
      record.recordId,
      { ...payload },
      input.executionTraceId,
    );
  }

  private async emitCaptureFailed(
    input: IDogfoodContextInput,
    recordId: string,
    error: Error,
    startMs: number,
  ): Promise<void> {
    if (!this.logger) return;
    const payload: IContextCaptureFailedPayload = {
      record_id: recordId,
      parent_trace_id: input.parentTraceId,
      child_trace_id: input.executionTraceId,
      step_id: input.stepId,
      turn: input.turn,
      attempt: input.attempt,
      reason: error.name,
      duration_ms: this.deps.now().getTime() - startMs,
    };
    await this.logger.info(DomainEventType.ContextCaptureFailed, recordId, { ...payload }, input.executionTraceId);
  }

  /** No-op for an unknown/already-closed recordId — callers invoke close()
   *  unconditionally on every terminal path (completion/failure/timeout/cancellation/
   *  parent shutdown), including ones where no connection was ever started. */
  async close(recordId: string, reason: ContextConnectionCloseReason): Promise<void> {
    const tracked = this.connections.get(recordId);
    if (!tracked) return;
    this.connections.delete(recordId);
    await tracked.handle.close(reason);
    await this.emitConnectionClosed(tracked.connectionId, reason);
  }

  private async emitConnectionClosed(connectionId: string, reason: string): Promise<void> {
    if (!this.logger) return;
    const payload: IContextConnectionClosedPayload = { connection_id: connectionId, reason };
    await this.logger.info(DomainEventType.ContextConnectionClosed, connectionId, { ...payload });
  }

  private containsKnownSecret(text: string): boolean {
    return this.deps.knownSecrets.some((secret) => secret.length > 0 && text.includes(secret));
  }

  /** Splits the remaining input budget between portal/memory. Each source's own
   *  configured ceiling wins unless the two together exceed what's left, in which case
   *  the remainder is split 2:1 portal:memory with integer floors (rounding unused). */
  private splitRemainingBudget(remainingBudget: number): { portalBudget: number; memoryBudget: number } {
    const { portalTokens, memoryTokens } = this.deps.config;
    if (portalTokens + memoryTokens <= remainingBudget) {
      return { portalBudget: portalTokens, memoryBudget: memoryTokens };
    }
    return {
      portalBudget: Math.floor((remainingBudget * 2) / 3),
      memoryBudget: Math.floor(remainingBudget / 3),
    };
  }

  private async queryPortal(
    queryText: string,
    signal?: Opt<AbortSignal, Reason.CancellationOptional>,
  ): Promise<IScoredContextResult> {
    return await this.deps.portalKnowledge.queryContext({
      portalAlias: this.deps.portalAlias,
      query: queryText,
      limit: this.deps.config.portalTopK,
      maxTokens: this.deps.config.portalTokens,
      signal,
    });
  }

  private async queryMemory(queryText: string, stepId: string): Promise<MemoryItem[]> {
    return await this.deps.memory.lookupMemories(
      queryText,
      undefined,
      { topK: this.deps.config.memoryTopK, expandLinks: false },
      { portalAlias: this.deps.portalAlias },
    ).catch(() => {
      // A memory-source failure must not discard a successful portal result.
      void stepId;
      return [];
    });
  }

  private buildSection(
    label: string,
    allocatorSection: string,
    allocatedTokens: number,
    actualTokens: number,
    extra: {
      selectedSourceIds: readonly string[];
      selectedScores: readonly number[];
      unavailableReason?: string;
      truncated: boolean;
    },
  ): ContextRecordSection {
    return {
      label,
      allocatorSection,
      allocatedTokens,
      actualTokens,
      selectedSourceIds: [...extra.selectedSourceIds],
      selectedScores: [...extra.selectedScores],
      omittedIds: [],
      truncated: extra.truncated,
      ...(extra.unavailableReason ? { unavailableReason: extra.unavailableReason } : {}),
    };
  }
}
