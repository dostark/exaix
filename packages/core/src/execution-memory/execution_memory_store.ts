/**
 * @module ExecutionMemoryStore
 * @path packages/core/src/execution-memory/execution_memory_store.ts
 * @description Unified per-execution memory store: one append-oriented JSONL log per execution
 *   trace serving both the runtime scratchpad's free-text notes (kind "note", soft-degrade on
 *   caps, rejected never truncated) and flow-orchestration namespace variables (kind
 *   "namespace", three-tier skip/truncate/throw failure model ported from the retired
 *   FlowNamespaceService). Read indexes hydrate from the durable log on first touch per
 *   trace_id, so a resumed flow's first read sees prior state (GAP-16).
 * @architectural-layer Services
 * @related-files ["packages/core/src/types/i_execution_memory_store.ts", "packages/schemas/src/memory_bank.ts", "packages/schemas/src/flow.ts"]
 *
 * @visible
 */
import { ensureDir, exists } from "@std/fs";
import { dirname, join } from "@std/path";
import { resolveMemoryExecutionRoot } from "../config/mod.ts";
import type { IEventLogger } from "../logger/mod.ts";
import { DomainEventType } from "../events/mod.ts";
import type { IToolResult } from "../types/i_tool_registry.ts";
import type { IExecutionMemoryStore } from "../types/i_execution_memory_store.ts";
import type { Opt, Reason } from "../types/optional_marker.ts";
import {
  DEFAULT_NAMESPACE_ENTRY_MAX_BYTES,
  DEFAULT_NAMESPACE_MAX_BYTES,
  DEFAULT_SCRATCHPAD_MAX_ENTRIES_PER_EXECUTION,
  DEFAULT_SCRATCHPAD_MAX_ENTRY_BYTES,
} from "../types/constants.ts";
import type { Config } from "@exaix/schemas/config.ts";
import type { IFlowNamespaceWrite } from "@exaix/schemas/flow.ts";
import type { IScratchpadEntry } from "@exaix/schemas/memory_bank.ts";
import type { JSONValue } from "../types/json.ts";

const LOG_FILE_NAME = "scratchpad.jsonl";
const VALID_NAMESPACE_KEY_PATTERN = /^[a-zA-Z0-9._-]+$/;

type INamespacePathObject = { [key: string]: JSONValue };

interface ITraceIndex {
  notes: IScratchpadEntry[];
  namespace: Map<string, IScratchpadEntry>;
}

/** Thrown when the total serialized size of a trace's namespace entries exceeds the quota after a batch is applied. */
export class NamespaceQuotaExceededError extends Error {
  constructor(traceId: string, byteSize: number, maxBytes: number) {
    super(`Namespace quota exceeded for ${traceId}: ${byteSize} bytes > ${maxBytes} limit`);
    this.name = "NamespaceQuotaExceededError";
  }
}

/** Unified per-execution memory store over one shared JSONL log per trace, isolated by entry kind. */
export class ExecutionMemoryStore implements IExecutionMemoryStore {
  private readonly executionDir: string;
  private readonly logger?: IEventLogger;
  private readonly encoder = new TextEncoder();
  private readonly indexByTrace = new Map<string, ITraceIndex>();

  constructor(config: Config, logger?: Opt<IEventLogger, Reason.OptionalDependency>) {
    this.executionDir = join(config.system.root!, resolveMemoryExecutionRoot(config.paths));
    this.logger = logger;
  }

  /** Resolves the per-trace log path (the retired FlowNamespaceService's getNamespacePath contract, now over the unified log). */
  getNamespacePath(traceId: string): string {
    return join(this.executionDir, traceId, LOG_FILE_NAME);
  }

  /** Appends one note-kind entry; rejects over-cap content and exhausted entry budgets with a clear error (never truncates). */
  async appendNote(traceId: string, content: string, tags?: Opt<string[], Reason.OptionalInput>): Promise<IToolResult> {
    await this.ensureHydrated(traceId);
    const index = this.indexByTrace.get(traceId)!;
    const contentBytes = this.encoder.encode(content).length;
    if (contentBytes > DEFAULT_SCRATCHPAD_MAX_ENTRY_BYTES) {
      return {
        success: false,
        error:
          `scratchpad entry rejected: ${contentBytes} bytes exceeds the ${DEFAULT_SCRATCHPAD_MAX_ENTRY_BYTES}-byte per-entry cap (content is not truncated)`,
      };
    }
    if (index.notes.length >= DEFAULT_SCRATCHPAD_MAX_ENTRIES_PER_EXECUTION) {
      return {
        success: false,
        error:
          `scratchpad full: max ${DEFAULT_SCRATCHPAD_MAX_ENTRIES_PER_EXECUTION} entries reached for this execution`,
      };
    }

    const entry: IScratchpadEntry = {
      id: crypto.randomUUID(),
      trace_id: traceId,
      content,
      ...(tags ? { tags } : {}),
      kind: "note",
      created_at: new Date().toISOString(),
    };

    await ensureDir(join(this.executionDir, traceId));
    // Single append-mode write per entry: O_APPEND keeps concurrent appends line-atomic.
    const file = await Deno.open(this.getNamespacePath(traceId), { append: true, create: true, write: true });
    try {
      await file.write(this.encoder.encode(JSON.stringify(entry) + "\n"));
    } finally {
      file.close();
    }
    index.notes.push(entry);

    this.logger?.info(
      DomainEventType.MemoryScratchpadEntryAdded,
      traceId,
      { trace_id: traceId, entry_id: entry.id, content_length: contentBytes },
      traceId,
    );

    return {
      success: true,
      data: { entry_id: entry.id, created_at: entry.created_at },
    };
  }

  /** Reads all note-kind entries for traceId (empty when the execution wrote nothing). */
  async readNotes(traceId: string): Promise<IScratchpadEntry[]> {
    await this.ensureHydrated(traceId);
    return [...this.indexByTrace.get(traceId)!.notes];
  }

  /** Reads the requested namespace keys for traceId; missing keys resolve to undefined. */
  async readKeys(traceId: string, keys: string[]): Promise<Record<string, string | undefined>> {
    await this.ensureHydrated(traceId);
    const namespace = this.indexByTrace.get(traceId)!.namespace;
    return Object.fromEntries(keys.map((key) => [key, namespace.get(key)?.content]));
  }

  /** Applies a flow step's namespace batch: skip-on-invalid-key, truncate-on-oversized-value, throw-only-on-total-quota (ported from FlowNamespaceService.writeEntries). */
  async writeNamespaceEntries(
    traceId: string,
    stepId: string,
    writes: IFlowNamespaceWrite[],
    stepOutput: string,
  ): Promise<void> {
    await this.ensureHydrated(traceId);
    const index = this.indexByTrace.get(traceId)!;
    let changed = false;

    for (const write of writes) {
      if (!VALID_NAMESPACE_KEY_PATTERN.test(write.key)) {
        console.warn(`Skipping invalid flow namespace key: ${write.key}`);
        continue;
      }

      const extractedValue = this.extractWriteValue(write, stepOutput);
      const cappedValue = this.capValueBytes(
        extractedValue,
        Math.min(DEFAULT_NAMESPACE_MAX_BYTES, DEFAULT_NAMESPACE_ENTRY_MAX_BYTES),
      );
      const previousEntry = index.namespace.get(write.key);
      const nextValue = write.mode === "append" && previousEntry
        ? `${previousEntry.content}\n${cappedValue}`
        : cappedValue;

      index.namespace.set(write.key, {
        id: crypto.randomUUID(),
        trace_id: traceId,
        content: nextValue,
        kind: "namespace",
        key: write.key,
        author_step_id: stepId,
        created_at: new Date().toISOString(),
      });
      changed = true;
    }

    if (!changed) {
      return;
    }

    const namespaceEntries = [...index.namespace.values()].sort((left, right) =>
      (left.key ?? "").localeCompare(right.key ?? "")
    );
    const serializedSize = namespaceEntries.reduce(
      (total, entry) => total + this.encoder.encode(JSON.stringify(entry)).length,
      0,
    );
    if (serializedSize > DEFAULT_NAMESPACE_MAX_BYTES) {
      throw new NamespaceQuotaExceededError(traceId, serializedSize, DEFAULT_NAMESPACE_MAX_BYTES);
    }

    await this.persistIndex(traceId, index);
  }

  private async persistIndex(traceId: string, index: ITraceIndex): Promise<void> {
    const namespaceEntries = [...index.namespace.values()].sort((left, right) =>
      (left.key ?? "").localeCompare(right.key ?? "")
    );
    const lines = [...index.notes, ...namespaceEntries].map((entry) => JSON.stringify(entry));
    const logPath = this.getNamespacePath(traceId);
    await ensureDir(dirname(logPath));
    await Deno.writeTextFile(logPath, lines.map((line) => line + "\n").join(""));
  }

  /** Hydrate-on-first-touch: replays the trace's durable log into the in-memory index before the first read/write in this instance. */
  private async ensureHydrated(traceId: string): Promise<void> {
    if (this.indexByTrace.has(traceId)) {
      return;
    }
    const index: ITraceIndex = { notes: [], namespace: new Map() };
    const logPath = this.getNamespacePath(traceId);
    if (await exists(logPath)) {
      const raw = await Deno.readTextFile(logPath);
      for (const line of raw.split("\n")) {
        if (line.trim().length === 0) {
          continue;
        }
        // Structural parse (no runtime schemas import — core boundary): entries written
        // before the kind discriminator existed default to "note".
        const parsed = JSON.parse(line) as IScratchpadEntry;
        const kind = parsed.kind ?? "note";
        if (kind === "namespace" && parsed.key) {
          index.namespace.set(parsed.key, parsed);
        } else {
          index.notes.push({ ...parsed, kind: "note" });
        }
      }
    }
    this.indexByTrace.set(traceId, index);
  }

  private extractWriteValue(write: IFlowNamespaceWrite, stepOutput: string): string {
    if (!write.from) {
      return stepOutput;
    }

    let parsedOutput: JSONValue;
    try {
      parsedOutput = JSON.parse(stepOutput);
    } catch {
      console.warn(`Flow namespace write fallback for ${write.key}: step output is not valid JSON`);
      return stepOutput;
    }

    const extracted = this.resolveDotPath(parsedOutput, write.from);
    if (extracted === undefined) {
      console.warn(`Flow namespace write fallback for ${write.key}: missing JSON path ${write.from}`);
      return stepOutput;
    }

    return typeof extracted === "string" ? extracted : JSON.stringify(extracted);
  }

  private resolveDotPath(source: JSONValue, path: string): JSONValue {
    const segments = path.split(".").filter((segment) => segment.length > 0);
    let current: JSONValue = source;

    for (const segment of segments) {
      if (typeof current !== "object" || current === null || !(segment in current)) {
        return undefined;
      }
      current = (current as INamespacePathObject)[segment];
    }

    return current;
  }

  private capValueBytes(value: string, maxBytes: number): string {
    if (this.encoder.encode(value).length <= maxBytes) {
      return value;
    }

    let endIndex = value.length;
    while (endIndex > 0 && this.encoder.encode(value.slice(0, endIndex)).length > maxBytes) {
      endIndex -= 1;
    }

    return value.slice(0, endIndex);
  }
}
