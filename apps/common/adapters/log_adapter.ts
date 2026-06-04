/**
 * @module LogServiceAdapter
 * @path apps/common/adapters/log_adapter.ts
 * @description Module for LogServiceAdapter, providing ILogService implementation that
 * bridges EventLogger outputs to the TUI log service interface.
 * @architectural-layer Services
 * @related-files ["packages/core/src/logger/structured_event_output.ts", "apps/tui/src/structured_log_service.ts"]
 */
import type { ILogService, IStructuredLogEntry, LogQueryOptions } from "@exaix/core/types";
import { EventLoggerStructuredOutput } from "@exaix/core/logger";
import type { IEventLoggerOutput } from "@exaix/core/logger";
import { join } from "@std/path";

interface LoggerWithOutputs {
  getOutputs(): IEventLoggerOutput[];
}

interface IFileSource {
  getBasePath(): string;
}

interface IObservableSource {
  subscribe(callback: (entry: IStructuredLogEntry) => void): () => void;
}

function findStructuredOutputSource(outputs: IEventLoggerOutput[]): IFileSource | undefined {
  for (const output of outputs) {
    if (output instanceof EventLoggerStructuredOutput) {
      return output;
    }
  }
  return undefined;
}

function findObservableSource(outputs: IEventLoggerOutput[]): IObservableSource | undefined {
  for (const output of outputs) {
    if (output instanceof EventLoggerStructuredOutput) {
      return output;
    }
  }
  return undefined;
}

export class LogServiceAdapter implements ILogService {
  constructor(private logger: LoggerWithOutputs) {}

  async getStructuredLogs(options: LogQueryOptions): Promise<IStructuredLogEntry[]> {
    const source = findStructuredOutputSource(this.logger.getOutputs());
    if (!source) return [];

    const logPath = source.getBasePath();
    const logs: IStructuredLogEntry[] = [];
    const limit = options.limit || 100;

    try {
      const filesToRead = await this.getLogFiles(logPath);

      for (const file of filesToRead) {
        if (logs.length >= limit) break;
        await this.processLogFile(file, options, logs, limit);
      }
    } catch (error) {
      console.error("Error reading structured logs:", error);
    }

    return logs;
  }

  private async getLogFiles(logPath: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const stat = await Deno.stat(logPath);
      if (stat.isDirectory) {
        for await (const entry of Deno.readDir(logPath)) {
          if (entry.isFile && entry.name.endsWith(".jsonl")) {
            files.push(join(logPath, entry.name));
          }
        }
      } else {
        files.push(logPath);
      }
    } catch {
      return [];
    }
    return files.sort().reverse();
  }

  private async processLogFile(
    file: string,
    options: LogQueryOptions,
    logs: IStructuredLogEntry[],
    limit: number,
  ): Promise<void> {
    const content = await Deno.readTextFile(file);
    const lines = content.trim().split("\n").reverse();

    for (const line of lines) {
      if (!line) continue;
      if (logs.length >= limit) break;

      try {
        const entry = JSON.parse(line) as IStructuredLogEntry;
        if (this.matchesFilters(entry, options)) {
          logs.push(entry);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  private matchesFilters(entry: IStructuredLogEntry, options: LogQueryOptions): boolean {
    if (options.level && !options.level.includes(entry.level)) return false;
    if (options.traceId && entry.context.trace_id !== options.traceId) return false;
    if (options.correlationId && entry.context.correlation_id !== options.correlationId) return false;
    if (options.identityId && entry.context.identity_id !== options.identityId) return false;
    return true;
  }

  subscribeToLogs(callback: (entry: IStructuredLogEntry) => void): () => void {
    const source = findObservableSource(this.logger.getOutputs());

    if (!source) {
      console.warn("Observable output not found in logger, log subscription will not work.");
      return () => {};
    }

    return source.subscribe(callback);
  }

  async getLogsByCorrelationId(correlationId: string): Promise<IStructuredLogEntry[]> {
    return await this.getStructuredLogs({ correlationId });
  }

  async getLogsByTraceId(traceId: string): Promise<IStructuredLogEntry[]> {
    return await this.getStructuredLogs({ traceId });
  }

  async getLogsByAgentId(identityId: string): Promise<IStructuredLogEntry[]> {
    return await this.getStructuredLogs({ identityId });
  }

  async exportLogs(filename: string, entries: IStructuredLogEntry[]): Promise<void> {
    const content = entries.map((e) => JSON.stringify(e)).join("\n");
    await Deno.writeTextFile(filename, content);
  }
}
