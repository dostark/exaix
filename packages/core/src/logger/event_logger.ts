/**
 * @module EventLogger
 * @path packages/core/src/logger/event_logger.ts
 * @description Unified logging service that writes to both console and IActivity Journal.
 * Supports child loggers, structured payloads, and consistent log levels across the system.
 * @architectural-layer Services
 * @related-files ["packages/core/src/logger/event_logger.ts", "packages/core/src/repositories/activity_repository.ts", "packages/core/src/types/service_context.ts"]
 */

import type { IDatabaseService } from "../types/i_database_service.ts";
import type { JSONValue } from "../types/json.ts";
import type { IActivityRepository } from "../repositories/activity_repository.ts";

import { ActivityActor, LogLevel } from "../types/enums.ts";
import type { Actor } from "../types/actor.ts";
import type { ILogEvent } from "../types/i_log_event.ts";
import { EventBusService } from "../observability/event_bus_service.ts";
import type { IEventBusService } from "../observability/event_bus_service.ts";
import {
  BYTES_PER_KB,
  DEFAULT_LOG_MAX_FILES,
  DEFAULT_LOG_MAX_SIZE_MB,
  SHARED_DEFAULT_ICONS,
} from "../types/constants.ts";
import { type LogMetadata, toSafeJson } from "../types/json.ts";
import type { IStreamingEvent } from "@exaix/schemas";
import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";

import {
  STREAMING_EVENT_FLOW_STATUS,
  STREAMING_EVENT_HEARTBEAT,
  STREAMING_EVENT_LLM_STREAM,
  STREAMING_EVENT_TOOL_END,
  STREAMING_EVENT_TOOL_START,
} from "../types/constants.ts";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * Configuration for EventLogger
 */
export interface IEventLoggerConfig {
  /** IActivityRepository instance (optional - allows console-only mode) */
  activityRepo?: IActivityRepository;

  /** DatabaseService instance (optional - allows console-only mode) - DEPRECATED: use activityRepo */
  db?: IDatabaseService;

  /** Event bus for live streaming (optional - defaults to no-op; only callers wanting live streaming need to pass) */
  eventBus?: IEventBusService;

  /** Prefix for console messages (e.g., "[Exaix]") */
  prefix?: string;

  /** Minimum log level to output */
  minLevel?: LogLevel;

  /** Whether to include timestamps in console output */
  showTimestamp?: boolean;

  /**
   * Default actor identity. For CLI commands, this should be the user identity
   * obtained from git config (user.email) or OS username.
   */
  defaultActor?: Actor;

  /** Optional output sinks for structured log formatting (console, file, etc.) */
  outputs?: IEventLoggerOutput[];
}

/**
 * Output sink interface for structured log formatting.
 * Implementations can write to console, file, or other destinations.
 */
export interface IEventLoggerOutput {
  write(event: ILogEvent): void | Promise<void>;
}

export interface IEventLogger {
  log(event: ILogEvent): Promise<void>;
  info(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void>;
  warn(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void>;
  error(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void>;
  fatal(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void>;
  debug(action: string, target: string | null, payload?: LogMetadata, traceId?: string): Promise<void>;
  child(overrides: Partial<ILogEvent>): IEventLogger;
}

// ============================================================================
// Implementation
// ============================================================================

/** Log level priority for filtering */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
  [LogLevel.FATAL]: 4,
};

/** Default icons for each log level */
const DEFAULT_ICONS: Record<LogLevel, string> = {
  [LogLevel.INFO]: SHARED_DEFAULT_ICONS.info,
  [LogLevel.WARN]: SHARED_DEFAULT_ICONS.warn,
  [LogLevel.ERROR]: SHARED_DEFAULT_ICONS.error,
  [LogLevel.DEBUG]: SHARED_DEFAULT_ICONS.debug,
  [LogLevel.FATAL]: SHARED_DEFAULT_ICONS.fatal,
};

/** Cached user identity to avoid repeated git calls */
let cachedUserIdentity: string | null = null;

// ============================================================================
// Output Implementations
// ============================================================================

/**
 * Console output with rich formatting (timestamp, level, context tags).
 */
class _ConsoleOutput implements IEventLoggerOutput {
  write(event: ILogEvent): void {
    const timestamp = new Date().toISOString();
    const level = (event.level ?? "INFO").toUpperCase().padEnd(5);
    const icon = SHARED_DEFAULT_ICONS[event.level as keyof typeof SHARED_DEFAULT_ICONS] ?? "·";
    let line = `${timestamp} ${level} ${icon} ${event.action}`;
    if (event.target) {
      line += `: ${event.target}`;
    }
    if (event.payload && Object.keys(event.payload).length > 0) {
      line += ` ${JSON.stringify(event.payload)}`;
    }
    const consoleFn = event.level === LogLevel.ERROR || event.level === LogLevel.FATAL
      ? console.error
      : event.level === LogLevel.WARN
      ? console.warn
      : console.log;
    consoleFn(line);
  }
}

/**
 * File output with log rotation (size-based).
 */
class _RotatingFileOutput implements IEventLoggerOutput {
  private currentFileSize = 0;
  private dirEnsured = false;

  constructor(
    private basePath: string,
    private options: { maxSizeMB?: number; maxFiles?: number } = {},
  ) {}

  async write(event: ILogEvent): Promise<void> {
    const line = JSON.stringify(event) + "\n";
    const lineSize = new TextEncoder().encode(line).length;

    if (this.shouldRotate(lineSize)) {
      await this.rotate();
    }

    try {
      if (!this.dirEnsured) {
        await ensureDir(dirname(this.basePath));
        this.dirEnsured = true;
      }
      await Deno.writeTextFile(this.basePath, line, { append: true });
      this.currentFileSize += lineSize;
    } catch (error) {
      console.error(`[RotatingFileOutput] Failed to write to ${this.basePath}:`, error);
    }
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
      // File may not exist yet
    }
    this.cleanupOldFiles(maxFiles);
    this.currentFileSize = 0;
  }

  private async cleanupOldFiles(maxFiles: number): Promise<void> {
    try {
      const dir = dirname(this.basePath);
      const basename = this.basePath.split("/").pop() ?? "exaix";
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
      // Ignore cleanup errors
    }
  }
}

/**
 * Observable output that allows subscribing to log entries (for TUI, tests).
 */
class _ObservableOutput implements IEventLoggerOutput {
  private subscribers: Set<(event: ILogEvent) => void> = new Set();

  write(event: ILogEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch (err) {
        console.error("[ObservableOutput] Subscriber error:", err);
      }
    }
  }

  subscribe(callback: (event: ILogEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
}

/**
 * Unified logging service that writes to both console and IActivity Journal.
 *
 * @example
 * ```typescript
 * const logger = new EventLogger({ db: dbService, prefix: "[Exaix]" });
 *
 * // Basic usage
 * logger.info("config.loaded", "", { checksum: "abc123" });
 *
 * // Create child logger for a service
 * const serviceLogger = logger.child({ actor: "system", traceId });
 * serviceLogger.warn("context.truncated", "loader", { files_skipped: 3 });
 * ```
 */
export class EventLogger implements IEventLogger {
  private readonly activityRepo?: IActivityRepository;
  private readonly db?: IDatabaseService; // DEPRECATED
  private readonly eventBus?: IEventBusService;
  private readonly prefix: string;
  private readonly minLevel: LogLevel;
  private readonly showTimestamp: boolean;
  private readonly defaultActor: Actor;
  private readonly defaults: Partial<ILogEvent>;
  private readonly outputs?: IEventLoggerOutput[];

  constructor(config: IEventLoggerConfig, defaults: Partial<ILogEvent> = {}) {
    this.activityRepo = config.activityRepo;
    this.db = config.db; // DEPRECATED
    this.outputs = config.outputs;
    // Use explicitly provided eventBus, or fall back to the global singleton
    this.eventBus = config.eventBus ?? EventBusService.getInstance();
    this.prefix = config.prefix ?? "";
    this.minLevel = config.minLevel ?? LogLevel.INFO;
    this.showTimestamp = config.showTimestamp ?? false;
    this.defaultActor = config.defaultActor ?? ActivityActor.SYSTEM;
    this.defaults = defaults;
  }

  /**
   * Log an event to both console and IActivity Journal
   */
  async log(event: ILogEvent): Promise<void>;
  async log(
    action: string,
    targetOrPayload: string | LogMetadata,
    payload?: LogMetadata,
  ): Promise<void>;
  async log(
    eventOrAction: ILogEvent | string,
    targetOrPayload?: string | LogMetadata,
    payload?: LogMetadata,
  ): Promise<void> {
    let event: ILogEvent;

    if (typeof eventOrAction === "string") {
      // Overloaded call: log(action, targetOrPayload, payload?)
      const action = eventOrAction;
      if (typeof targetOrPayload === "string") {
        // log(action, target, payload?)
        event = { action, target: targetOrPayload, payload };
      } else {
        // log(action, payload) - target defaults to empty string
        event = { action, target: "", payload: targetOrPayload };
      }
    } else {
      // Standard call: log(event)
      event = eventOrAction;
    }

    const level = event.level ?? LogLevel.INFO;

    // Check if this level should be logged
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    // Merge with defaults
    const mergedEvent: ILogEvent = {
      ...this.defaults,
      ...event,
      actor: event.actor ?? this.defaults.actor ?? this.defaultActor,
      traceId: event.traceId ?? this.defaults.traceId ?? crypto.randomUUID(),
    };

    // Log to console
    this.logToConsole(mergedEvent, level);

    // Write to configured output sinks (file, observable, etc.)
    if (this.outputs) {
      for (const output of this.outputs) {
        try {
          const result = output.write(mergedEvent);
          if (result instanceof Promise) {
            result.catch((err) => console.error("[EventLogger] Output write failed:", err));
          }
        } catch (err) {
          console.error("[EventLogger] Output write failed:", err);
        }
      }
    }

    // Log to IActivity Journal
    await this.logToDatabase(mergedEvent);

    // Publish to event bus for live streaming (non-blocking, no-op if no bus)
    if (this.eventBus && mergedEvent.traceId) {
      const streamingEvent: IStreamingEvent = {
        eventId: crypto.randomUUID(),
        traceId: mergedEvent.traceId,
        timestamp: new Date().toISOString(),
        type: this.resolveStreamingEventType(mergedEvent.action),
        payload: mergedEvent.payload ?? {},
      };
      this.eventBus.publish(streamingEvent);
    }
  }

  /**
   * Log an info-level event
   */
  async info(
    action: string,
    target: string,
    payload?: LogMetadata,
    traceId?: string,
  ): Promise<void> {
    await this.logWithLevel(LogLevel.INFO, action, target, payload, traceId);
  }

  /**
   * Log a warning-level event
   */
  async warn(
    action: string,
    target: string,
    payload?: LogMetadata,
    traceId?: string,
  ): Promise<void> {
    await this.logWithLevel(LogLevel.WARN, action, target, payload, traceId);
  }

  /**
   * Log an error-level event
   */
  async error(
    action: string,
    target: string,
    payload?: LogMetadata,
    traceId?: string,
  ): Promise<void> {
    await this.logWithLevel(LogLevel.ERROR, action, target, payload, traceId);
  }

  /**
   * Log a debug-level event
   */
  async debug(
    action: string,
    target: string,
    payload?: LogMetadata,
    traceId?: string,
  ): Promise<void> {
    await this.logWithLevel(LogLevel.DEBUG, action, target, payload, traceId);
  }

  /**
   * Log a fatal-level event
   */
  async fatal(
    action: string,
    target: string,
    payload?: LogMetadata,
    traceId?: string,
  ): Promise<void> {
    await this.logWithLevel(LogLevel.FATAL, action, target, payload, traceId);
  }

  private async logWithLevel(
    level: LogLevel,
    action: string,
    target: string,
    payload?: Opt<LogMetadata, Reason.OptionalContext>,
    traceId?: string,
  ): Promise<void> {
    await this.log({
      action,
      target,
      payload: payload ? (toSafeJson(payload) as Record<string, JSONValue>) : undefined,
      level,
      traceId,
    });
  }

  /**
   * Create a child logger with preset values (e.g., for a specific service)
   */
  child(defaults: Partial<ILogEvent>): EventLogger {
    const mergedDefaults: Partial<ILogEvent> = {
      ...this.defaults,
      ...defaults,
    };

    const childConfig: IEventLoggerConfig = {
      db: this.db,
      prefix: this.prefix,
      minLevel: this.minLevel,
      showTimestamp: this.showTimestamp,
      defaultActor: this.defaultActor,
      eventBus: this.eventBus,
    };

    return new EventLogger(childConfig, mergedDefaults);
  }

  /**
   * Get user identity from git config or OS username.
   * Results are cached after first call.
   */
  static async getUserIdentity(): Promise<string> {
    if (cachedUserIdentity) {
      return cachedUserIdentity;
    }

    // Try git config user.email
    try {
      const command = new Deno.Command("git", {
        args: ["config", "user.email"],
        stdout: "piped",
        stderr: "null",
      });
      const { code, stdout } = await command.output();
      if (code === 0) {
        const email = new TextDecoder().decode(stdout).trim();
        if (email) {
          cachedUserIdentity = email;
          return email;
        }
      }
    } catch {
      // git not available, continue to fallbacks
    }

    // Try git config user.name
    try {
      const command = new Deno.Command("git", {
        args: ["config", "user.name"],
        stdout: "piped",
        stderr: "null",
      });
      const { code, stdout } = await command.output();
      if (code === 0) {
        const name = new TextDecoder().decode(stdout).trim();
        if (name) {
          cachedUserIdentity = name;
          return name;
        }
      }
    } catch {
      // git not available, continue to fallbacks
    }

    // Fallback to OS username
    const osUser = Deno.env.get("USER") ?? Deno.env.get("USERNAME") ?? "unknown";
    cachedUserIdentity = osUser;
    return osUser;
  }

  /**
   * Clear cached user identity (mainly for testing)
   */
  static clearIdentityCache(): void {
    cachedUserIdentity = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Format and log event to console
   */
  private logToConsole(event: ILogEvent, level: LogLevel): void {
    const icon = event.icon ?? DEFAULT_ICONS[level];
    const timestamp = this.showTimestamp ? this.formatTimestamp() + " " : "";
    const prefix = this.prefix ? this.prefix + " " : "";

    // Build main message line
    const mainLine = `${timestamp}${icon} ${event.action}: ${event.target}`;

    // Select appropriate console method
    const consoleFn = level === LogLevel.ERROR ? console.error : level === LogLevel.WARN ? console.warn : console.log;

    consoleFn(prefix + mainLine);

    // Log payload values indented
    if (event.payload && Object.keys(event.payload).length > 0) {
      for (const [key, value] of Object.entries(event.payload)) {
        const valueStr = typeof value === "object" ? JSON.stringify(value) : String(value);
        consoleFn(`   ${key}: ${valueStr}`);
      }
    }
  }

  /**
   * Log event to IActivity Journal database
   */
  private async logToDatabase(event: ILogEvent): Promise<void> {
    // Prefer IActivityRepository over direct DatabaseService
    if (this.activityRepo) {
      try {
        await this.activityRepo.logActivity({
          actor: event.actor ?? this.defaultActor,
          actorType: event.actorType ?? null,
          actionType: event.action,
          target: event.target,
          payload: event.payload ?? {},
          traceId: event.traceId,
          identityId: event.identityId ?? null,
          agentKind: event.agentKind ?? null,
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          costUsd: event.costUsd,
        });
      } catch (error) {
        // Database write failed - log warning but don't crash
        console.warn(`[EventLogger] Failed to write to IActivity Journal via repository:`, error);
      }
    } else if (this.db) {
      // Fallback to deprecated direct database access
      try {
        this.db.logActivity(
          event.actor ?? this.defaultActor,
          event.action,
          event.target,
          event.payload ?? {},
          event.traceId,
          event.actorType ?? null,
          event.identityId ?? null,
          event.agentKind ?? null,
          event.promptTokens,
          event.completionTokens,
          event.costUsd,
        );
      } catch (error) {
        // Database write failed - log warning but don't crash
        console.warn(`[EventLogger] Failed to write to IActivity Journal:`, error);
      }
    }
  }

  /**
   * Format current timestamp for console output
   */
  private formatTimestamp(): string {
    const now = new Date();
    return now.toISOString().slice(11, 19); // HH:MM:SS
  }

  /**
   * Map an ILogEvent action to a streaming event type.
   * Uses heuristics based on action name patterns.
   */
  private resolveStreamingEventType(action: string): IStreamingEvent["type"] {
    const lower = action.toLowerCase();
    if (lower.includes("heartbeat") || lower.includes("alive")) {
      return STREAMING_EVENT_HEARTBEAT;
    }
    if (lower.includes("tool") && (lower.includes("start") || lower.includes("call"))) {
      return STREAMING_EVENT_TOOL_START;
    }
    if (lower.includes("tool") && (lower.includes("end") || lower.includes("done") || lower.includes("complete"))) {
      return STREAMING_EVENT_TOOL_END;
    }
    if (lower.includes("llm") || lower.includes("stream") || lower.includes("generate")) {
      return STREAMING_EVENT_LLM_STREAM;
    }
    return STREAMING_EVENT_FLOW_STATUS;
  }
}
