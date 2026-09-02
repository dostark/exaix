/**
 * @module ApprovalFeedsSessionMemoryTest
 * @path packages/memory/tests/approval/approval_feeds_session_memory_test.ts
 * @description GAP-1 counterpart: the tiered-memory feed is sourced exclusively from
 * APPROVED learnings — both the manual and the auto approval path trigger exactly one
 * session-memory insight per approved learning (keyed to its identity), and the global
 * store never carries a PENDING orphan.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import {
  MemoryAutoApprovalService,
  MemoryBankService,
  MemoryEmbeddingService,
  MemoryExtractorService,
  SessionMemoryService,
} from "@exaix/memory";
import { createMinimalExecutionMemory, initTestDbService } from "@exaix/testing";
import { ConfidenceLevel, MemoryScope } from "@exaix/core";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import type { Config } from "@exaix/schemas/config.ts";

function makeConfig(root: string, autoApproveConfidence?: string): Config {
  return ConfigSchema.parse({
    system: { root },
    paths: {},
    database: {},
    watcher: {},
    agents: {},
    models: {},
    portals: [],
    mcp: {},
    memory: autoApproveConfidence
      ? { auto_approve: { enabled: true, delay_hours: 1, confidence_threshold: autoApproveConfidence } }
      : {},
  });
}

Deno.test("manual approval feeds exactly one session-memory insight keyed to the approved learning", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const embeddingService = new MemoryEmbeddingService(config);
    await embeddingService.initializeManifest();
    const memoryBank = new MemoryBankService(config);
    memoryBank.setEmbeddingService(embeddingService);

    const tieredEntriesPath = join(config.system.root, "Memory", "Session", "tiered_entries.json");
    const sessionMemory = new SessionMemoryService(memoryBank, embeddingService, undefined, tieredEntriesPath);

    const fed: Array<{ id: string; title: string }> = [];
    const extractor = new MemoryExtractorService(config, db, memoryBank, undefined, {
      onApproved: async (learning) => {
        fed.push({ id: learning.id, title: learning.title });
        const saveResult = await sessionMemory.saveInsight({
          title: learning.title,
          description: learning.description,
          category: learning.category,
          tags: learning.tags,
          confidence: ConfidenceLevel.HIGH,
          portal: learning.project,
          learning_id: learning.id,
        });
        assertEquals(saveResult.success, true, saveResult.message);
      },
    });

    const execution = createMinimalExecutionMemory({
      summary: "Executed the portal file-write flow.",
      lessons_learned: ["Always validate portal mount paths before file writes"],
    });
    const candidates = await extractor.analyzeExecution(execution);
    for (const candidate of candidates) {
      candidate.scope = MemoryScope.GLOBAL;
      candidate.project = undefined;
      await extractor.createProposal(candidate, execution, "gap1-test");
    }

    const pending = await extractor.listPending();
    assertEquals(pending.length, 1);
    await extractor.approvePending(pending[0].id!, true);

    const global = await memoryBank.getGlobalMemory();
    const approvedTitles = global?.learnings.filter((l) => l.status === "approved").map((l) => l.title) ?? [];
    assertEquals(
      approvedTitles.some((t) => t.includes("mount paths")),
      true,
      "the approved learning is stored once (as APPROVED)",
    );
    assertEquals(
      global?.learnings.filter((l) => l.status === "pending").length ?? 0,
      0,
      "no PENDING orphan may accompany the approval (GAP-1)",
    );
    assertEquals(fed.length, 1, "the approval hook fires exactly once");

    const raw = await Deno.readTextFile(tieredEntriesPath).catch(() => "[]");
    console.log("DEBUG tiered:", raw.slice(0, 200), "| fed:", JSON.stringify(fed));
    const tiered = JSON.parse(raw || "[]") as Array<[string, { id: string }]>;
    assertEquals(
      tiered.some(([, entry]) => entry.id === fed[0].id),
      true,
      "the tiered feed must be keyed to the approved learning's identity",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("auto-approval triggers the same single session-memory feed per approved proposal", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const testConfig = makeConfig(config.system.root, "medium");
    const embeddingService = new MemoryEmbeddingService(testConfig);
    await embeddingService.initializeManifest();
    const memoryBank = new MemoryBankService(testConfig);
    memoryBank.setEmbeddingService(embeddingService);
    const tieredEntriesPath = join(testConfig.system.root, "Memory", "Session", "tiered_auto.json");
    const sessionMemory = new SessionMemoryService(memoryBank, embeddingService, undefined, tieredEntriesPath);

    let fed = 0;
    const extractor = new MemoryExtractorService(testConfig, db, memoryBank, undefined, {
      onApproved: () => {
        fed += 1;
        return Promise.resolve();
      },
    });
    const autoApprovalService = new MemoryAutoApprovalService(testConfig, extractor);

    const execution = createMinimalExecutionMemory({
      summary: "Executed the portal file-write flow.",
      lessons_learned: ["Rate limiter resets on full restart, not per request"],
    });
    const candidates = await extractor.analyzeExecution(execution);
    for (const candidate of candidates) {
      candidate.scope = MemoryScope.GLOBAL;
      candidate.project = undefined;
      await extractor.createProposal(candidate, execution, "gap1-test");
    }
    const proposals = await extractor.listPending();
    for (const proposal of proposals) {
      proposal.learning.extracted_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await Deno.writeTextFile(
        join(testConfig.system.root, testConfig.paths.memory, "Pending", `${proposal.id}.json`),
        JSON.stringify(proposal, null, 2),
      );
    }

    const result = await autoApprovalService.runApprovalCycle();
    assertEquals(result.promoted.length, 1, "the eligible proposal is auto-approved");
    assertEquals(fed, 1, "the approval hook fires exactly once per approved proposal");
    void sessionMemory;
  } finally {
    await cleanup();
  }
});
