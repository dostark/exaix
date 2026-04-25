/**
 * @module DatabaseService
 * @path src/services/core/db.ts
 * @description Provides persistent storage for the Activity Journal and system state using SQLite.
 * Implements batched writes, transactions with retries, and circuit breaker protection.
 * @architectural-layer Services
 * * @related-files [src/services/event_logger.ts, src/services/database_connection_pool.ts]
 */
import { z } from "zod";
import { Database } from "@db/sqlite";
import { join } from "@std/path";
import { ensureDirSync } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import { CircuitBreaker } from "../../ai/circuit_breaker.ts";
import { DB_MAX_RETRY_DELAY_MS, DEFAULT_QUERY_LIMIT } from "@exaix/core";
import type { JSONValue } from "@exaix/core";
import type { IDatabaseService } from "../../shared/interfaces/i_database_service.ts";
import type { IJournalFilterOptions } from "../../shared/types/database.ts";

export type SqliteParam = string | number | boolean | null;

interface LogEntry {
  activityId: string;
  traceId: string;
  actor: string;
  actorType: string | null;
  identityId: string | null;
  agentKind: string | null;
  actionType: string;
  target: string | null;
  payload: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  timestamp: string;
}

/** Activity record schema for database validation */
export const ActivityRecordSchema = z.object({
  id: z.string(),
  trace_id: z.string(),
  actor: z.string().nullable(),
  actor_type: z.string().nullable(),
  identity_id: z.string().nullable(),
  agent_kind: z.string().nullable().optional(),
  action_type: z.string(),
  target: z.string().nullable(),
  payload: z.string(),
  prompt_tokens: z.number().int().min(0).optional().default(0),
  completion_tokens: z.number().int().min(0).optional().default(0),
  cost_usd: z.number().min(0).optional().default(0),
  timestamp: z.string(),
  count: z.number().optional(),
});

/** Activity record returned from database queries */
export type ActivityRecord = z.infer<typeof ActivityRecordSchema>;

interface DatabaseConfigExtended {
  failure_threshold?: number;
  reset_timeout_ms?: number;
  half_open_success_threshold?: number;
}

export type { IDatabaseService };

export class DatabaseService implements IDatabaseService {
  private db: Database;
  private logQueue: LogEntry[] = [];
  private flushTimer: number | null = null;
  private readonly FLUSH_INTERVAL_MS: number;
  private readonly MAX_BATCH_SIZE: number;
  private isClosing = false;
  private readonly dbBreaker: CircuitBreaker;

  constructor(config: Config) {
    const dbDir = join(config.system.root!, config.paths.runtime!);
    const dbPath = join(dbDir, "journal.db");

    // Ensure database directory exists (fixes CI issues with temp directories)
    ensureDirSync(dbDir);

    this.db = new Database(dbPath);
    // Enable configured SQLite features
    this.db.exec(`PRAGMA journal_mode = ${config.database.sqlite.journal_mode};`);
    this.db.exec(`PRAGMA foreign_keys = ${config.database.sqlite.foreign_keys ? "ON" : "OFF"};`);
    this.db.exec(`PRAGMA busy_timeout = ${config.database.sqlite.busy_timeout_ms};`);

    // Load batch configuration
    this.FLUSH_INTERVAL_MS = config.database.batch_flush_ms;
    this.MAX_BATCH_SIZE = config.database.batch_max_size;

    const dbCfg = config.database;
    const breakerOpts = {
      failureThreshold: dbCfg?.failure_threshold ?? 5,
      resetTimeout: dbCfg?.reset_timeout_ms ?? 60_000,
      halfOpenSuccessThreshold: dbCfg?.half_open_success_threshold ?? 2,
    };
    this.dbBreaker = new CircuitBreaker(breakerOpts);
  }

  /**
   * Get the raw Database instance
   */
  get instance(): Database {
    return this.db;
  }

  /**
   * Log an activity to the journal (non-blocking, batched writes)
   */
  logActivity(
    actor: string,
    actionType: string,
    target: string | null,
    payload: Record<string, JSONValue>,
    traceId?: string,
    actorType?: string | null,
    identityId?: string | null,
    agentKind?: string | null,
    promptTokens?: number,
    completionTokens?: number,
    costUsd?: number,
  ): void {
    if (this.isClosing) {
      console.warn("Cannot log activity: DatabaseService is closing");
      return;
    }

    const entry: LogEntry = {
      activityId: crypto.randomUUID(),
      traceId: traceId || crypto.randomUUID(),
      actor,
      actorType: actorType || null,
      identityId: identityId || null,
      agentKind: agentKind || null,
      actionType,
      target,
      payload: JSON.stringify(payload),
      promptTokens: promptTokens || 0,
      completionTokens: completionTokens || 0,
      costUsd: costUsd || 0,
      timestamp: new Date().toISOString(),
    };

    this.logQueue.push(entry);

    // Flush immediately if batch size exceeded
    if (this.logQueue.length >= this.MAX_BATCH_SIZE) {
      this.flush();
    } else if (!this.flushTimer) {
      // Schedule flush after interval
      this.flushTimer = setTimeout(() => this.flush(), this.FLUSH_INTERVAL_MS);
    }
  }

  /**
   * Wait for all pending log entries to be flushed
   * Returns a promise that resolves when the queue is empty
   */
  async waitForFlush(): Promise<void> {
    // If there's nothing queued, return immediately
    if (this.logQueue.length === 0) return;

    // Trigger flush if scheduled
    this.flush();

    // Wait for queue to be empty using exponential backoff
    let attempts = 0;
    const maxAttempts = 20; // Max 2 seconds (100ms * 20)
    while (this.logQueue.length > 0 && attempts < maxAttempts) {
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
      attempts++;
      if (this.logQueue.length > 0) {
        // Small delay if queue is still not empty
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // One more microtask to ensure writes completed
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
  }

  /**
   * Execute a function within a transaction with retry logic
   */
  /**
   * Execute database operations with retry logic for transient failures
   * @private
   */
  /**
   * Execute database operations with retry logic for transient failures.
   *
   * The `callback` may be asynchronous and its returned promise will be awaited.
   * Callers should `await` the result of `retryTransaction` and may return values
   * from the callback. Example usage:
   *
   * await this.retryTransaction(async () => {
   *   await this.db.exec(...);
   *   return someValue;
   * });
   */
  private async retryTransaction<T>(
    callback: () => Promise<T>,
    options: RetryOptions = {},
  ): Promise<T> {
    const {
      maxRetries = 3,
      baseDelay = 100,
      maxDelay = DB_MAX_RETRY_DELAY_MS,
      backoffFactor = 2,
      jitter = true,
    } = options;

    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        // Begin transaction, await callback result (supports async callbacks)
        this.db.exec("BEGIN IMMEDIATE TRANSACTION");
        const result = await callback();
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        // Rollback on error
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // Ignore rollback errors
        }

        const lastError = error instanceof Error ? error : new Error(String(error));
        attempt++;

        // Check if this is a retryable error (database locked)
        const isRetryable = lastError.message.includes("database is locked") ||
          lastError.message.includes("database table is locked");

        if (!isRetryable || attempt > maxRetries) {
          throw lastError;
        }

        // Calculate delay with exponential backoff
        let delay = baseDelay * Math.pow(backoffFactor, attempt - 1);

        // Add jitter to prevent thundering herd
        if (jitter) {
          delay = delay * (0.5 + Math.random() * 0.5); // ±50% jitter
        }

        // Cap maximum delay
        delay = Math.min(delay, maxDelay);

        // Non-blocking delay
        await new Promise((resolve) => setTimeout(resolve, delay));

        // Log retry attempt (if logger available)
        console.debug(`Database retry attempt ${attempt}/${maxRetries} after ${delay}ms delay: ${lastError.message}`);
      }
    }

    throw new Error("Unreachable code");
  }

  /**
   * Execute batch insert with transaction handling
   * @private
   */
  private async executeBatchInsert(batch: LogEntry[], context: string): Promise<void> {
    try {
      await this.dbBreaker.execute(() =>
        this.retryTransaction(() => {
          for (const entry of batch) {
            this.db.exec(
              `INSERT INTO activity (id, trace_id, actor, actor_type, identity_id, agent_kind, action_type, target, payload, prompt_tokens, completion_tokens, cost_usd, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )`,
              [
                entry.activityId ?? null,
                entry.traceId ?? null,
                entry.actor ?? null,
                entry.actorType ?? null,
                entry.identityId ?? null,
                entry.agentKind ?? null,
                entry.actionType ?? null,
                entry.target ?? null,
                entry.payload ?? null,
                entry.promptTokens ?? 0,
                entry.completionTokens ?? 0,
                entry.costUsd ?? 0,
                entry.timestamp ?? null,
              ],
            );
          }
          return Promise.resolve();
        })
      );
    } catch (error) {
      console.error(`Failed to flush ${batch.length} activity logs (${context}):`, error);
    }
  }

  /**
   * Flush pending log entries to database
   */
  private flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.logQueue.length === 0) return;

    const batch = this.logQueue.splice(0);

    // Write asynchronously without blocking
    queueMicrotask(async () => {
      await this.executeBatchInsert(batch, "flush");
    });
  }

  /**
   * Close the database connection and flush pending logs
   */
  private clearFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async flushPendingLogs(context: string): Promise<void> {
    this.clearFlushTimer();

    if (this.logQueue.length > 0) {
      const batch = this.logQueue.splice(0);
      await this.executeBatchInsert(batch, context);
    }
  }

  private parseActivityRows(rows: Array<z.input<typeof ActivityRecordSchema>>): ActivityRecord[] {
    return z.array(ActivityRecordSchema).parse(rows);
  }

  private async queryByFieldSafe(
    field: string,
    value: string,
  ): Promise<ActivityRecord[]> {
    const stmt = this.db.prepare(
      `SELECT id, trace_id, actor, actor_type, identity_id, agent_kind, action_type, target, payload, prompt_tokens, completion_tokens, cost_usd, timestamp
       FROM activity
       WHERE ${field} = ?
       ORDER BY timestamp`,
    );

    return await this.dbBreaker.execute(() => {
      const rows = stmt.all(value) as Array<z.input<typeof ActivityRecordSchema>>;
      return Promise.resolve(this.parseActivityRows(rows));
    });
  }

  async close(): Promise<void> {
    this.isClosing = true;

    await this.flushPendingLogs("close");

    this.db.close();
  }

  /**
   * Query activities by trace_id (for testing/debugging)
   */
  getActivitiesByTrace(traceId: string): ActivityRecord[] {
    const stmt = this.db.prepare(
      `SELECT id, trace_id, actor, actor_type, identity_id, agent_kind, action_type, target, payload, prompt_tokens, completion_tokens, cost_usd, timestamp
       FROM activity
       WHERE trace_id = ?
       ORDER BY timestamp`,
    );

    const rows = stmt.all(traceId);
    return z.array(ActivityRecordSchema).parse(rows);
  }

  /**
   * Async, breaker-safe version of `getActivitiesByTrace`.
   */
  async getActivitiesByTraceSafe(traceId: string): Promise<ActivityRecord[]> {
    return await this.queryByFieldSafe("trace_id", traceId);
  }

  /**
   * Query activities by action_type (for testing/debugging)
   */
  getActivitiesByActionType(actionType: string): ActivityRecord[] {
    const stmt = this.db.prepare(
      `SELECT id, trace_id, actor, actor_type, identity_id, agent_kind, action_type, target, payload, prompt_tokens, completion_tokens, cost_usd, timestamp
       FROM activity
       WHERE action_type = ?
       ORDER BY timestamp`,
    );

    const rows = stmt.all(actionType);
    return z.array(ActivityRecordSchema).parse(rows);
  }

  /**
   * Async, breaker-safe version of `getActivitiesByActionType`.
   */
  async getActivitiesByActionTypeSafe(actionType: string): Promise<ActivityRecord[]> {
    return await this.queryByFieldSafe("action_type", actionType);
  }

  /**
   * Query recent activities (for testing/debugging)
   */
  async getRecentActivity(limit: number = 100): Promise<ActivityRecord[]> {
    await this.flushPendingLogs("getRecentActivity");

    const stmt = this.db.prepare(
      `SELECT id, trace_id, actor, actor_type, identity_id, agent_kind, action_type, target, payload, prompt_tokens, completion_tokens, cost_usd, timestamp
       FROM activity
       ORDER BY timestamp DESC
       LIMIT ?`,
    );

    // Use breaker to protect this query
    return await this.dbBreaker.execute(() => {
      const rows = stmt.all(limit);
      return Promise.resolve(z.array(ActivityRecordSchema).parse(rows));
    });
  }

  /**
   * Query activity journal with flexible filters
   */
  async queryActivity(filter: IJournalFilterOptions): Promise<ActivityRecord[]> {
    await this.flushPendingLogs("queryActivity");

    // Build SELECT clause
    let selectClause = `SELECT `;
    if (filter.distinct) {
      selectClause += `DISTINCT ${filter.distinct}`;
    } else if (filter.count) {
      selectClause += `action_type, COUNT(*) as count`;
    } else {
      selectClause +=
        `id, trace_id, actor, actor_type, identity_id, agent_kind, action_type, target, payload, prompt_tokens, completion_tokens, cost_usd, timestamp`;
    }

    // Build WHERE clause
    const whereParts: string[] = [];
    const params: SqliteParam[] = [];

    if (filter.orConditions && filter.orConditions.length > 0) {
      // Handle OR conditions
      const orParts: string[] = [];
      for (const orFilter of filter.orConditions) {
        const orWhere = this.buildWhereClause(orFilter, params);
        if (orWhere) {
          orParts.push(`(${orWhere})`);
        }
      }
      if (orParts.length > 0) {
        whereParts.push(`(${orParts.join(" OR ")})`);
      }
    } else {
      // Handle single condition
      const where = this.buildWhereClause(filter, params);
      if (where) {
        whereParts.push(where);
      }
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    let query = `${selectClause} FROM activity ${whereClause}`;

    // Add GROUP BY for count queries
    if (filter.count) {
      query += ` GROUP BY action_type`;
    }

    query += ` ORDER BY timestamp DESC`;
    query += ` LIMIT ?`;
    params.push(filter.limit || DEFAULT_QUERY_LIMIT);

    const stmt = this.db.prepare(query);
    return await this.dbBreaker.execute(() => {
      const rows = stmt.all(...params);
      return Promise.resolve(z.array(ActivityRecordSchema).parse(rows));
    });
  }

  /**
   * Execute a prepared statement and return a single row (breaker-protected)
   */
  async preparedGet<T>(query: string, params: SqliteParam[] = []): Promise<T | null> {
    const stmt = this.db.prepare(query);
    return await this.dbBreaker.execute(() => Promise.resolve(stmt.get(...params) as T | null));
  }

  /**
   * Execute a prepared statement and return all rows (breaker-protected)
   */
  async preparedAll<T>(query: string, params: SqliteParam[] = []): Promise<T[]> {
    const stmt = this.db.prepare(query);
    return await this.dbBreaker.execute(() => Promise.resolve(stmt.all(...params) as T[]));
  }

  /**
   * Execute a prepared run (INSERT/UPDATE/DELETE) (breaker-protected)
   */
  async preparedRun(query: string, params: SqliteParam[] = []): Promise<unknown> {
    const stmt = this.db.prepare(query);
    return await this.dbBreaker.execute(() => Promise.resolve(stmt.run(...params)));
  }

  private buildWhereClause(filter: IJournalFilterOptions, params: SqliteParam[]): string {
    const conditions: string[] = [];

    if (filter.traceId) {
      conditions.push(`trace_id = ?`);
      params.push(filter.traceId);
    }

    if (filter.actionType) {
      if (filter.actionType.includes("%")) {
        conditions.push(`action_type LIKE ?`);
      } else {
        conditions.push(`action_type = ?`);
      }
      params.push(filter.actionType);
    }

    if (filter.identityId) {
      conditions.push(`identity_id = ?`);
      params.push(filter.identityId);
    }

    if (filter.payload) {
      conditions.push(`payload LIKE ?`);
      params.push(filter.payload);
    }

    if (filter.actor) {
      conditions.push(`actor = ?`);
      params.push(filter.actor);
    }

    if (filter.target) {
      conditions.push(`target = ?`);
      params.push(filter.target);
    }

    if (filter.since) {
      conditions.push(`timestamp > ?`);
      params.push(filter.since);
    }

    return conditions.join(" AND ");
  }
}

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  jitter?: boolean;
}
