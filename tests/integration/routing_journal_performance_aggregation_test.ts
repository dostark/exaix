/**
 * @module RoutingJournalPerformanceAggregationTest
 * @path tests/integration/routing_journal_performance_aggregation_test.ts
 * @description Verifies Phase 74 Step 74.3 — AgentRolePerformanceRepository aggregates
 *   real journal rows through the live SQLite backend and stays bounded on a large
 *   journal (query cap + latency ceiling).
 * @architectural-layer Integration
 * @dependencies [@exaix/routing, @exaix/testing, @std/assert]
 * @related-files [packages/routing/src/agent_role_performance_repository.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { AgentRolePerformanceRepository } from "@exaix/routing";
import { initTestDbService } from "@exaix/testing";

/** Rows seeded to exceed the repository's internal query cap of 1000. */
const LARGE_JOURNAL_SEED_COUNT = 1100;

/** Upper bound the repository applies to a single aggregation query. */
const QUERY_ROW_LIMIT = 1000;

/** Seed rows in chunks below the writer's batch size, awaiting each flush. */
const SEED_CHUNK_SIZE = 50;

/** Latency ceiling for one bounded aggregation over the large journal. */
const AGGREGATION_LATENCY_CEILING_MS = 2000;

interface ISeedOptions {
  agentRole: string;
  version: string;
  capability: string;
  portal: string;
  success: boolean;
  confidence: number;
  promptTokens: number;
  costUsd: number;
}

function seedActivity(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  index: number,
  options: ISeedOptions,
): void {
  db.logActivity(
    "agent",
    "agent.execution.completed",
    options.portal,
    {
      success: options.success,
      confidence: options.confidence,
      capabilities: [options.capability],
      version: options.version,
      portal: options.portal,
    },
    `trace-${index}`,
    "agent",
    options.agentRole,
    null,
    options.promptTokens,
    0,
    options.costUsd,
  );
}

Deno.test("[integration] AgentRolePerformanceRepository aggregates real journal rows by capability", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    seedActivity(db, 1, {
      agentRole: "senior-coder",
      version: "2.0.0",
      capability: "code_review",
      portal: "TestPortal",
      success: true,
      confidence: 90,
      promptTokens: 120,
      costUsd: 0.12,
    });
    seedActivity(db, 2, {
      agentRole: "senior-coder",
      version: "2.0.0",
      capability: "code_review",
      portal: "TestPortal",
      success: false,
      confidence: 50,
      promptTokens: 80,
      costUsd: 0.08,
    });
    await db.waitForFlush();

    const repo = new AgentRolePerformanceRepository({ db });
    const snapshots = await repo.getPerformanceByCapability("code_review", "TestPortal");

    assertEquals(snapshots.length, 1);
    assertEquals(snapshots[0].agentRole, "senior-coder");
    assertEquals(snapshots[0].version, "2.0.0");
    assertEquals(snapshots[0].sampleSize, 2);
    assertEquals(snapshots[0].successRate, 0.5);
    assertEquals(snapshots[0].averagePromptTokens, 100);
    assert(Math.abs(snapshots[0].averageCostUsd - 0.1) < 1e-9);
    assertEquals(snapshots[0].stable, false);
  } finally {
    await db.close();
    await cleanup();
  }
});

Deno.test("[integration] AgentRolePerformanceRepository marks a real snapshot stable at the sample threshold", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    for (let index = 0; index < 5; index++) {
      seedActivity(db, index, {
        agentRole: "stability-agent",
        version: "1.0.0",
        capability: "code_review",
        portal: "TestPortal",
        success: true,
        confidence: 80,
        promptTokens: 100,
        costUsd: 0.1,
      });
    }
    await db.waitForFlush();

    const repo = new AgentRolePerformanceRepository({ db });
    const snapshots = await repo.getPerformanceByAgentRole("stability-agent");

    assertEquals(snapshots.length, 1);
    assertEquals(snapshots[0].sampleSize, 5);
    assertEquals(snapshots[0].stable, true);
  } finally {
    await db.close();
    await cleanup();
  }
});

Deno.test("[integration] aggregation stays bounded on a large seeded journal", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    for (let index = 0; index < LARGE_JOURNAL_SEED_COUNT; index++) {
      seedActivity(db, index, {
        agentRole: "bulk-agent",
        version: "1.0.0",
        capability: "bulk_review",
        portal: "BulkPortal",
        success: index % 2 === 0,
        confidence: 70,
        promptTokens: 100,
        costUsd: 0.1,
      });
      if ((index + 1) % SEED_CHUNK_SIZE === 0) {
        await db.waitForFlush();
      }
    }
    await db.waitForFlush();

    const repo = new AgentRolePerformanceRepository({ db });
    const startedAt = performance.now();
    const snapshots = await repo.getPerformanceByCapability("bulk_review", "BulkPortal");
    const elapsedMs = performance.now() - startedAt;

    assertEquals(snapshots.length, 1);
    assert(
      snapshots[0].sampleSize <= QUERY_ROW_LIMIT,
      `aggregation must stay within the ${QUERY_ROW_LIMIT}-row query cap, got ${snapshots[0].sampleSize}`,
    );
    assert(
      elapsedMs <= AGGREGATION_LATENCY_CEILING_MS,
      `bounded aggregation took ${elapsedMs.toFixed(0)}ms, ceiling ${AGGREGATION_LATENCY_CEILING_MS}ms`,
    );
  } finally {
    await db.close();
    await cleanup();
  }
});
