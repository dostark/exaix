/**
 * @module EventLoggerStructuredOutput
 * @path packages/core/src/logger/structured_event_output.ts
 * @description Converts ILogEvent to IStructuredLogEntry for TUI consumption.
 * Writes JSONL files with size-based rotation and supports live subscriber notifications.
 * @architectural-layer Services
 * @related-files ["packages/core/src/logger/event_logger.ts", "packages/core/src/types/logging.ts"]
 */
import type { ILogEvent } from "../types/i_log_event.ts";
import { LogLevel } from "../types/enums.ts";
import type { ILogContext, IStructuredLogEntry } from "../types/logging.ts";
import type { LogMetadata } from "@exaix/core";
import {
  BYTES_PER_KB,
  DEFAULT_LOG_MAX_FILES,
  DEFAULT_LOG_MAX_SIZE_MB,
  DEFAULT_MCP_SERVER_NAME,
} from "../types/constants.ts";
import { dirname, join } from "@std/path";
import { ensureDirSync } from "@std/fs";
import type { IEventLoggerOutput } from "./event_logger.ts";

/**
 * Converts ILogEvent → IStructuredLogEntry for TUI StructuredLogViewer consumption.
 * Writes JSONL files with size-based rotation and supports live subscribers.
 *
 * Add to EventLogger's `outputs` config to produce viewer-compatible files.
 */
export class EventLoggerStructuredOutput implements IEventLoggerOutput {
  private currentFileSize = 0;
  private dirEnsured = false;
  private subscribers: Set<(entry: IStructuredLogEntry) => void> = new Set();

  constructor(
    private basePath: string,
    private options: { maxSizeMB?: number; maxFiles?: number } = {},
  ) {}

  write(event: ILogEvent): void {
    const entry = this.toStructuredEntry(event);
    const line = JSON.stringify(entry) + "\n";
    const lineSize = new TextEncoder().encode(line).length;

    if (this.shouldRotate(lineSize)) {
      this.rotate();
    }

    if (!this.dirEnsured) {
      try {
        ensureDirSync(dirname(this.basePath));
        this.dirEnsured = true;
      } catch (err) {
        console.error("[EventLoggerStructuredOutput] Failed to create directory:", err);
      }
    }

    try {
      Deno.writeTextFileSync(this.basePath, line, { append: true });
    } catch (err) {
      console.error(`[EventLoggerStructuredOutput] Failed to write to ${this.basePath}:`, err);
    }

    this.currentFileSize += lineSize;

    for (const subscriber of this.subscribers) {
      try {
        subscriber(entry);
      } catch (err) {
        console.error("[EventLoggerStructuredOutput] Subscriber error:", err);
      }
    }
  }

  subscribe(callback: (entry: IStructuredLogEntry) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  getBasePath(): string {
    return this.basePath;
  }

  private toStructuredEntry(event: ILogEvent): IStructuredLogEntry {
    const action = event.action;
    const target = event.target;
    const message = target ? `${action}: ${target}` : action;
    const context: ILogContext = {};
    if (event.traceId) context.trace_id = event.traceId;
    if (event.identityId) context.identity_id = event.identityId;
    if (event.actor) context.operation = String(event.actor);
    if (event.agentId) context.agent_id = event.agentId;

    const metadata: LogMetadata = {};
    if (event.payload) {
      for (const [k, v] of Object.entries(event.payload)) {
        metadata[k] = v;
      }
    }
    if (event.promptTokens !== undefined) metadata.promptTokens = event.promptTokens;
    if (event.completionTokens !== undefined) metadata.completionTokens = event.completionTokens;
    if (event.costUsd !== undefined) metadata.costUsd = event.costUsd;

    return {
      timestamp: new Date().toISOString(),
      level: event.level ?? LogLevel.INFO,
      message,
      context,
      metadata: Object.keys(metadata).length > 0 ? (metadata as LogMetadata) : undefined,
    };
  }

  private shouldRotate(newLineSize: number): boolean {
    const maxSize = (this.options.maxSizeMB ?? DEFAULT_LOG_MAX_SIZE_MB) * BYTES_PER_KB * BYTES_PER_KB;
    return this.currentFileSize + newLineSize > maxSize;
  }

  private async rotate(): Promise<void> {
    const maxFiles = this.options.maxFiles ?? DEFAULT_LOG_MAX_FILES;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rotatedPath = `${this.basePath}.${timestamp}`;
    try {
      await Deno.rename(this.basePath, rotatedPath);
    } catch {
      // source file may not exist yet
    }
    await this.cleanupOldFiles(maxFiles);
    this.currentFileSize = 0;
  }

  private async cleanupOldFiles(maxFiles: number): Promise<void> {
    try {
      const dir = dirname(this.basePath);
      const basename = this.basePath.split("/").pop() ?? DEFAULT_MCP_SERVER_NAME;
      const files: Array<{ name: string; mtime: Date }> = [];
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.startsWith(`${basename}.`)) {
          const stat = await Deno.stat(join(dir, entry.name));
          files.push({ name: entry.name, mtime: stat.mtime! });
        }
      }
      files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      for (let i = maxFiles; i < files.length; i++) {
        await Deno.remove(join(dir, files[i].name));
      }
    } catch {
      // best-effort cleanup
    }
  }
}
