/**
 * @module DatabaseConnectionPoolTest
 * @path tests/services/database_connection_pool_test.ts
 * @description Verifies the resource management logic for the SQLite connection pool, ensuring
 * efficient reuse of handles and strict enforcement of concurrency limits.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { DatabaseConnectionPool } from "../../../src/services/database_connection_pool.ts";
import { createMockConfig } from "../../helpers/config.ts";

/**
 * Tests for DatabaseConnectionPool
 */

Deno.test("DatabaseConnectionPool: initializes with configuration", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "pool-test-" });
  try {
    const config = createMockConfig(tempDir);
    const pool = new DatabaseConnectionPool({
      minConnections: 2,
      maxConnections: 10,
      idleTimeoutMs: 30000,
      acquireTimeoutMs: 5000,
    }, config);

    // Pool should be initialized but empty
    assertEquals(pool.getPoolSize(), 0);
    assertEquals(pool.getAvailableCount(), 0);
    assertEquals(pool.getWaitingCount(), 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DatabaseConnectionPool: acquires connection from available pool", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "pool-test-" });
  try {
    const config = createMockConfig(tempDir);
    // Create runtime directory for database
    await Deno.mkdir(`${tempDir}/${config.paths.runtime}`, { recursive: true });

    const pool = new DatabaseConnectionPool({
      minConnections: 0,
      maxConnections: 5,
      idleTimeoutMs: 30000,
      acquireTimeoutMs: 5000,
    }, config);

    // Acquire first connection (should create new)
    const conn1 = await pool.acquire();
    assertEquals(pool.getPoolSize(), 1);
    assertEquals(pool.getAvailableCount(), 0);

    // Release it back to pool
    pool.release(conn1);
    assertEquals(pool.getPoolSize(), 1);
    assertEquals(pool.getAvailableCount(), 1);

    // Acquire again (should get from pool)
    const conn2 = await pool.acquire();
    assertEquals(conn1, conn2); // Should be same connection
    assertEquals(pool.getPoolSize(), 1);
    assertEquals(pool.getAvailableCount(), 0);

    await pool.destroy();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DatabaseConnectionPool: creates new connections up to max limit", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "pool-test-" });
  try {
    const config = createMockConfig(tempDir);
    // Create runtime directory for database
    await Deno.mkdir(`${tempDir}/${config.paths.runtime}`, { recursive: true });

    const pool = new DatabaseConnectionPool({
      minConnections: 0,
      maxConnections: 3,
      idleTimeoutMs: 30000,
      acquireTimeoutMs: 5000,
    }, config);

    // Acquire multiple connections
    const conn1 = await pool.acquire();
    const conn2 = await pool.acquire();
    const conn3 = await pool.acquire();

    assertEquals(pool.getPoolSize(), 3);
    assertEquals(pool.getAvailableCount(), 0);

    // Release all
    pool.release(conn1);
    pool.release(conn2);
    pool.release(conn3);

    assertEquals(pool.getPoolSize(), 3);
    assertEquals(pool.getAvailableCount(), 3);

    await pool.destroy();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DatabaseConnectionPool: destroys all connections", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "pool-test-" });
  try {
    const config = createMockConfig(tempDir);
    // Create runtime directory for database
    await Deno.mkdir(`${tempDir}/${config.paths.runtime}`, { recursive: true });

    const pool = new DatabaseConnectionPool({
      minConnections: 0,
      maxConnections: 3,
      idleTimeoutMs: 30000,
      acquireTimeoutMs: 5000,
    }, config);

    // Create some connections
    const _conn1 = await pool.acquire();
    const _conn2 = await pool.acquire();

    assertEquals(pool.getPoolSize(), 2);

    // Destroy pool
    await pool.destroy();

    assertEquals(pool.getPoolSize(), 0);
    assertEquals(pool.getAvailableCount(), 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DatabaseConnectionPool: queues requests when at max capacity", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "pool-test-" });
  try {
    const config = createMockConfig(tempDir);
    // Create runtime directory for database
    await Deno.mkdir(`${tempDir}/${config.paths.runtime}`, { recursive: true });

    const pool = new DatabaseConnectionPool({
      minConnections: 0,
      maxConnections: 2,
      idleTimeoutMs: 30000,
      acquireTimeoutMs: 5000,
    }, config);

    // Fill the pool
    const _conn1 = await pool.acquire();
    const _conn2 = await pool.acquire();
    assertEquals(pool.getPoolSize(), 2);
    assertEquals(pool.getAvailableCount(), 0);

    // Third acquire should queue
    const acquirePromise3 = pool.acquire();
    assertEquals(pool.getWaitingCount(), 1);

    // Release one connection - queued request should get it
    pool.release(_conn1);
    const _conn3 = await acquirePromise3;

    assertEquals(pool.getWaitingCount(), 0);
    assertEquals(pool.getAvailableCount(), 0);

    await pool.destroy();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DatabaseConnectionPool: times out queued requests", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "pool-test-" });
  try {
    const config = createMockConfig(tempDir);
    // Create runtime directory for database
    await Deno.mkdir(`${tempDir}/${config.paths.runtime}`, { recursive: true });

    const pool = new DatabaseConnectionPool({
      minConnections: 0,
      maxConnections: 1,
      idleTimeoutMs: 30000,
      acquireTimeoutMs: 100, // Short timeout for testing
    }, config);

    // Fill the pool
    const _conn1 = await pool.acquire();

    // Second acquire should timeout
    await assertRejects(
      () => pool.acquire(),
      Error,
      "Connection acquire timeout",
    );

    assertEquals(pool.getWaitingCount(), 0);

    await pool.destroy();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
