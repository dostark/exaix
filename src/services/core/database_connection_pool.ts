/**
 * @module DatabaseConnectionPool
 * @path src/services/core/database_connection_pool.ts
 * @description Manages a pool of SQLite database connections with WAL mode and busy timeout handling.
 * @architectural-layer Services
 * @related-files ["src/services/core/db.ts"]
 */
import { Database } from "@db/sqlite";
import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import { DEFAULT_DATABASE_BUSY_TIMEOUT_MS } from "@exaix/core";

/**
 * Database connection interface for pooling
 */
export interface IDatabaseConnection {
  instance: Database;
  close(): Promise<void>;
}

export type DatabaseConnection = IDatabaseConnection;

/**
 * SQLite database connection implementation
 */
export class SQLiteConnection implements IDatabaseConnection {
  constructor(
    public instance: Database,
    private config: Config,
  ) {}

  async close(): Promise<void> {
    await this.instance.close();
  }
}

/**
 * Database connection pool for managing concurrent database access
 */
export class DatabaseConnectionPool {
  private pool: IDatabaseConnection[] = [];
  private available: IDatabaseConnection[] = [];
  private waiting: Array<{ resolve: (conn: IDatabaseConnection) => void; timeoutId: number }> = [];
  private destroyed = false;

  constructor(
    private options: {
      minConnections: number;
      maxConnections: number;
      idleTimeoutMs: number;
      acquireTimeoutMs: number;
    },
    private config: Config,
  ) {}

  /**
   * Acquire a database connection from the pool
   */
  async acquire(): Promise<IDatabaseConnection> {
    if (this.destroyed) {
      throw new Error("Connection pool has been destroyed");
    }

    // Try to get an available connection
    const conn = this.available.pop();
    if (conn) {
      return conn;
    }

    // Create new connection if under limit
    if (this.pool.length < this.options.maxConnections) {
      const newConn = await this.createConnection();
      this.pool.push(newConn);
      return newConn;
    }

    // Wait for available connection
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Remove this waiter from the queue
        const index = this.waiting.findIndex((w) => w.timeoutId === timeoutId);
        if (index >= 0) {
          this.waiting.splice(index, 1);
        }
        reject(new Error("Connection acquire timeout"));
      }, this.options.acquireTimeoutMs);

      this.waiting.push({
        resolve: (conn) => {
          clearTimeout(timeoutId);
          // Remove this waiter from the queue
          const index = this.waiting.findIndex((w) => w.timeoutId === timeoutId);
          if (index >= 0) {
            this.waiting.splice(index, 1);
          }
          resolve(conn);
        },
        timeoutId,
      });
    });
  }

  /**
   * Release a connection back to the pool
   */
  release(conn: IDatabaseConnection): void {
    if (this.destroyed) {
      conn.close().catch(console.error);
      return;
    }

    // If there are waiters, give connection to first waiter
    if (this.waiting.length > 0) {
      const waiter = this.waiting.shift();
      waiter?.resolve(conn);
      return;
    }

    // Otherwise, add back to available pool
    this.available.push(conn);
  }

  /**
   * Create a new database connection
   */
  private async createConnection(): Promise<IDatabaseConnection> {
    const dbPath = join(this.config.system.root, this.config.paths.runtime, "journal.db");
    const db = new Database(dbPath);

    // Enable WAL mode for concurrency
    await db.exec("PRAGMA journal_mode = WAL;");
    await db.exec("PRAGMA foreign_keys = ON;");
    // Set busy timeout to 5000ms to handle concurrency
    await db.exec(`PRAGMA busy_timeout = ${DEFAULT_DATABASE_BUSY_TIMEOUT_MS};`);

    return await new SQLiteConnection(db, this.config);
  }

  /**
   * Destroy the pool and close all connections
   */
  async destroy(): Promise<void> {
    this.destroyed = true;

    // Clear waiting queue - these promises will reject
    this.waiting.splice(0);

    // Close all connections
    const closePromises = this.pool.map((conn) => conn.close());
    this.pool = [];
    this.available = [];

    await Promise.all(closePromises);
  }

  /**
   * Get current pool size (total connections)
   */
  getPoolSize(): number {
    return this.pool.length;
  }

  /**
   * Get number of available connections
   */
  getAvailableCount(): number {
    return this.available.length;
  }

  /**
   * Get number of waiting requests
   */
  getWaitingCount(): number {
    return this.waiting.length;
  }

  /**
   * Check if pool has been destroyed
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }
}
