/**
 * @module StructuredLogger
 * @path src/services/structured_logger.ts
 * @description Comprehensive observability service. Implements security audit item 17.
 *
 * Responsibilities:
 * - Structured logging with consistent format and context (trace_id, etc.)
 * - Multiple output destinations (console, file, DB)
 * - Performance tracking and audit evaluation
 *
 * Required Deno permissions:
 * - --allow-write, --allow-read (for log rotation)
 *
 * @architectural-layer Services
 * @dependencies [Config, Path, FS]
 * @related-files [src/services/event_logger.ts, src/main.ts]
 */

import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import * as DEFAULTS from "../../shared/constants.ts";

// ============================================================================
// Types and Interfaces
// ============================================================================

import { LogLevel, LogRotationInterval } from "../../shared/enums.ts";
import { LogMetadata } from "../../shared/types/json.ts";
import { ILogger, ILogOutput } from "../../shared/interfaces/i_log_service.ts";
import { IStructuredLogEntry } from "../../shared/types/logging.ts";

export type IStructuredLogger = ILogger;
export { type ILogger, type ILogOutput, type IStructuredLogEntry };

export interface IStructuredLoggerConfig {
  minLevel: LogLevel;
  outputs: ILogOutput[];
  enablePerformanceTracking: boolean;
  serviceName?: string;
  version?: string;
}

/**
 * Output that allows subscribing to log entries.
 */
export class ObservableOutput implements ILogOutput {
  private subscribers: Set<(entry: IStructuredLogEntry) => void> = new Set();

  write(entry: IStructuredLogEntry): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(entry);
      } catch (err) {
        console.error("[ObservableOutput] Subscriber error:", err);
      }
    }
  }

  subscribe(callback: (entry: IStructuredLogEntry) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
}

// ============================================================================
// Output Implementations
// ============================================================================

export class ConsoleOutput implements ILogOutput {
  write(entry: IStructuredLogEntry): void {
    const formatted = this.formatEntry(entry);
    const consoleMethod = this.getConsoleMethod(entry.level);
    consoleMethod(formatted);
  }

  private formatEntry(entry: IStructuredLogEntry): string {
    const timestamp = new Date(entry.timestamp).toISOString();
    const level = entry.level.toUpperCase().padEnd(5);
    const context = this.formatContext(entry.context);
    const metadata = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : "";
    const error = entry.error ? ` ERROR: ${entry.error.name}: ${entry.error.message}` : "";
    const performance = entry.performance ? ` PERF: ${JSON.stringify(entry.performance)}` : "";

    return `${timestamp} ${level} ${entry.message}${context}${metadata}${error}${performance}`;
  }

  private formatContext(context: IStructuredLogEntry["context"]): string {
    const parts: string[] = [];
    if (context.trace_id) parts.push(`trace=${context.trace_id.slice(0, 8)}`);
    if (context.request_id) parts.push(`req=${context.request_id.slice(0, 8)}`);
    if (context.user_id) parts.push(`user=${context.user_id}`);
    if (context.identity_id) parts.push(`agent=${context.identity_id}`);
    if (context.operation) parts.push(`op=${context.operation}`);

    return parts.length > 0 ? ` [${parts.join(" ")}]` : "";
  }

  private getConsoleMethod(level: LogLevel): (message: string) => void {
    switch (level) {
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        return console.error;
      case LogLevel.WARN:
        return console.warn;
      default:
        return console.log;
    }
  }
}

export class FileOutput implements ILogOutput {
  private currentFilePath: string;
  private currentFileSize = 0;
  private dirEnsured = false;

  constructor(
    private basePath: string,
    private options: {
      maxSizeMB?: number;
      maxFiles?: number;
      rotationInterval?: LogRotationInterval;
    } = {},
  ) {
    // If basePath doesn't end with the configured extension, treat it as a directory
    if (!basePath.endsWith(DEFAULTS.LOG_FILE_EXTENSION)) {
      this.currentFilePath = this.generateFilePath();
    } else {
      this.currentFilePath = basePath;
    }
  }

  /**
   * Get the log directory or base file path.
   */
  getBasePath(): string {
    return this.basePath;
  }

  async write(entry: IStructuredLogEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    const lineSize = new TextEncoder().encode(line).length;

    // Check if rotation is needed
    if (this.shouldRotate(lineSize)) {
      await this.rotate();
    }

    try {
      if (!this.dirEnsured) {
        await ensureDir(dirname(this.currentFilePath));
        this.dirEnsured = true;
      }
      await Deno.writeTextFile(this.currentFilePath, line, { append: true });
      this.currentFileSize += lineSize;
    } catch (error) {
      // Fallback to console if file write fails
      console.error(`[FileOutput] Failed to write to log file ${this.currentFilePath}:`, error);
    }
  }

  private shouldRotate(newLineSize: number): boolean {
    const maxSize = (this.options.maxSizeMB ?? DEFAULTS.DEFAULT_LOG_MAX_SIZE_MB) * 1024 * 1024;
    return this.currentFileSize + newLineSize > maxSize;
  }

  private async rotate(): Promise<void> {
    const maxFiles = this.options.maxFiles ?? DEFAULTS.DEFAULT_LOG_MAX_FILES;

    // Rename current file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rotatedPath = `${this.currentFilePath}.${timestamp}`;

    try {
      await Deno.rename(this.currentFilePath, rotatedPath);
    } catch {
      // File might not exist yet, continue
    }

    // Clean up old files if we exceed maxFiles
    await this.cleanupOldFiles(maxFiles);

    // Generate new file path
    this.currentFilePath = this.generateFilePath();
    this.currentFileSize = 0;
  }

  private async cleanupOldFiles(maxFiles: number): Promise<void> {
    try {
      const dir = join(this.basePath, "..");
      const files: Array<{ name: string; mtime: Date }> = [];

      for await (const entry of Deno.readDir(dir)) {
        if (
          entry.isFile && entry.name.startsWith(`${DEFAULTS.LOG_FILE_PREFIX}.`) &&
          entry.name.endsWith(DEFAULTS.LOG_FILE_EXTENSION)
        ) {
          const stat = await Deno.stat(join(dir, entry.name));
          files.push({ name: entry.name, mtime: stat.mtime! });
        }
      }

      // Sort by modification time (newest first)
      files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Remove files beyond maxFiles
      for (let i = maxFiles; i < files.length; i++) {
        await Deno.remove(join(dir, files[i].name));
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private generateFilePath(): string {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD

    if (this.options.rotationInterval === "hourly") {
      const hourStr = now.getHours().toString().padStart(2, "0");
      return join(this.basePath, `${DEFAULTS.LOG_FILE_PREFIX}-${dateStr}-${hourStr}${DEFAULTS.LOG_FILE_EXTENSION}`);
    }

    return join(this.basePath, `${DEFAULTS.LOG_FILE_PREFIX}-${dateStr}${DEFAULTS.LOG_FILE_EXTENSION}`);
  }
}

// ============================================================================
// Core Logger Implementation
// ============================================================================

export class StructuredLogger implements IStructuredLogger {
  private context: Partial<IStructuredLogEntry["context"]> = {};
  private readonly config: IStructuredLoggerConfig;

  constructor(config: IStructuredLoggerConfig) {
    this.config = config;
  }

  /**
   * Get configured outputs for the logger.
   */
  getOutputs(): ILogOutput[] {
    return [...this.config.outputs];
  }

  setContext(context: Partial<IStructuredLogEntry["context"]>): void {
    this.context = { ...this.context, ...context };
  }

  child(additionalContext: Partial<IStructuredLogEntry["context"]>): StructuredLogger {
    const child = new StructuredLogger(this.config);
    child.context = { ...this.context, ...additionalContext };
    return child;
  }

  debug(message: string, metadata?: LogMetadata): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  info(message: string, metadata?: LogMetadata): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  warn(message: string, metadata?: LogMetadata): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  error(message: string, error?: Error, metadata?: LogMetadata): void {
    this.log(LogLevel.ERROR, message, metadata, error);
  }

  fatal(message: string, error?: Error, metadata?: LogMetadata): void {
    this.log(LogLevel.FATAL, message, metadata, error);
  }

  async time<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: LogMetadata,
  ): Promise<T> {
    if (!this.config.enablePerformanceTracking) {
      return fn();
    }

    const startTime = performance.now();
    const startMemory = Deno.memoryUsage?.().heapUsed ?? 0;

    try {
      const result = await fn();
      const duration = performance.now() - startTime;
      const memoryDelta = (Deno.memoryUsage?.().heapUsed ?? 0) - startMemory;

      this.info(`Operation completed: ${operation}`, {
        ...metadata,
        performance: {
          duration_ms: Math.round(duration),
          memory_delta_mb: Math.round(memoryDelta / 1024 / 1024 * 100) / 100,
        },
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.error(`Operation failed: ${operation}`, error as Error, {
        ...metadata,
        performance: {
          duration_ms: Math.round(duration),
          failed: true,
        },
      });
      throw error;
    }
  }

  private log(
    level: LogLevel,
    message: string,
    metadata?: LogMetadata,
    error?: Error,
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: IStructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.context },
      metadata,
      error: error
        ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: "code" in error ? String((error as { code?: unknown }).code) : undefined,
        }
        : undefined,
    };

    // Write to all configured outputs
    for (const output of this.config.outputs) {
      try {
        const result = output.write(entry);
        if (result instanceof Promise) {
          result.catch((err) => console.error("[StructuredLogger] Output write failed:", err));
        }
      } catch (err) {
        console.error("[StructuredLogger] Output write failed:", err);
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.FATAL];
    const minIndex = levels.indexOf(this.config.minLevel);
    const currentIndex = levels.indexOf(level);
    return currentIndex >= minIndex;
  }
}

// ============================================================================
// Global Logger Instance
// ============================================================================

let globalLogger: StructuredLogger | null = null;

export function getGlobalLogger(): StructuredLogger {
  if (!globalLogger) {
    throw new Error("Global logger not initialized. Call initializeGlobalLogger() first.");
  }
  return globalLogger;
}

export function initializeGlobalLogger(config: IStructuredLoggerConfig): StructuredLogger {
  globalLogger = new StructuredLogger(config);
  return globalLogger;
}

// For testing purposes only
export function resetGlobalLogger(): void {
  globalLogger = null;
}

// Convenience functions for global logger
export function logDebug(message: string, metadata?: LogMetadata): void {
  getGlobalLogger().debug(message, metadata);
}

export function logInfo(message: string, metadata?: LogMetadata): void {
  getGlobalLogger().info(message, metadata);
}

export function logWarn(message: string, metadata?: LogMetadata): void {
  getGlobalLogger().warn(message, metadata);
}

export function logError(message: string, error?: Error, metadata?: LogMetadata): void {
  getGlobalLogger().error(message, error, metadata);
}

export function logFatal(message: string, error?: Error, metadata?: LogMetadata): void {
  getGlobalLogger().fatal(message, error, metadata);
}
