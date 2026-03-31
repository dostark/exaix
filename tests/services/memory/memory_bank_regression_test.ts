/**
 * @module MemoryBankRegressionTest
 * @path tests/services/memory/memory_bank_regression_test.ts
 * @description Regression tests for the MemoryBankService, verifying long-term stability
 * of advanced keyword and tag-based search combinations.
 */

import { assert, assertEquals } from "@std/assert";
import { MemoryType } from "../../../src/shared/enums.ts";
import { MemoryStatus } from "../../../src/shared/status/memory_status.ts";
import {
  type ISearchDeps,
  searchByKeyword,
  searchByTags,
  searchMemoryAdvanced,
} from "../../../src/services/memory/memory_search.ts";
import { IExecutionMemory, type IProjectMemory } from "../../../src/shared/schemas/memory_bank.ts";
import { createTestLearning } from "../helpers/memory_test_helpers.ts";
import {
  ConfidenceLevel,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryScope,
} from "../../../src/shared/enums.ts";

Deno.test("[regression] searchByKeyword finds patterns, decisions and overview", async () => {
  const projectsDir = await Deno.makeTempDir({ prefix: "exatest-" });
  // create two project directories
  await Deno.mkdir(`${projectsDir}/projA`);
  await Deno.mkdir(`${projectsDir}/projB`);

  const deps: ISearchDeps = {
    projectsDir,
    getProjectMemory: (portal: string) => {
      if (portal === "projA") {
        return Promise.resolve({
          portal: "projA",
          overview: "An overview mentioning Foobar and X features.",
          patterns: [
            { name: "PatternOne", description: "Contains X keyword here", examples: [], tags: ["alpha"] },
          ],
          decisions: [
            { date: "2026-01-01", decision: "Choose X", rationale: "Because X is fast", tags: ["alpha"] },
          ],
          references: [],
        });
      }
      if (portal === "projB") {
        return Promise.resolve({
          portal: "projB",
          overview: "Nothing interesting",
          patterns: [],
          decisions: [],
          references: [],
        });
      }
      return Promise.resolve(null);
    },
    getExecutionHistory: (_portal?: string, _limit?: number) => {
      const execMemory: IExecutionMemory = {
        trace_id: "550e8400-e29b-41d4-a716-446655440009",
        portal: "projA",
        summary: "Execution mentioning X in summary",
        started_at: new Date().toISOString(),
        request_id: "req-1",
        status: ExecutionStatus.COMPLETED,
        identity_id: "test",
        context_files: [],
        context_portals: [],
        changes: { files_created: [], files_modified: [], files_deleted: [] },
        lessons_learned: [],
      };
      return Promise.resolve([execMemory]);
    },
    loadLearningsFromFile: () =>
      Promise.resolve([
        createTestLearning({
          id: "550e8400-e29b-41d4-a716-446655440001",
          title: "ILearning as ILearning X",
          description: "About X",
          status: MemoryStatus.APPROVED,
          tags: ["alpha"],
          category: LearningCategory.INSIGHT,
          confidence: ConfidenceLevel.HIGH,
          scope: MemoryScope.GLOBAL,
          source: MemoryBankSource.IDENTITY,
        }),
      ]),
    calculateFrequency: (text: string | undefined, keywordLower: string) => {
      if (!text) return 0;
      const matches = text.toLowerCase().match(new RegExp(keywordLower, "gi"));
      return matches ? matches.length : 0;
    },
    calculateRelevance: (titleFreq: number, descFreq: number) =>
      Math.min(0.99, 0.5 + (titleFreq * 0.15) + (descFreq * 0.05)),
  };

  const results = await searchByKeyword("X", { portal: "projA", limit: 10 }, deps);
  // Expect at least pattern, decision, project overview, and learning entries
  const types = results.map((r) => r.type);
  assert(types.includes(MemoryType.PATTERN));
  assert(types.includes(MemoryType.DECISION));
  // `searchByKeyword` checks project overviews (PROJECT) and does not
  // currently include execution search results, so expect PROJECT here.
  assert(types.includes(MemoryType.PROJECT));
  assert(types.includes(MemoryType.LEARNING));

  // cleanup
  await Deno.remove(projectsDir, { recursive: true });
});

Deno.test("[regression] searchByTags returns matching items and learnings", async () => {
  const projectsDir = await Deno.makeTempDir({ prefix: "exatest-" });
  await Deno.mkdir(`${projectsDir}/projA`);

  const deps: ISearchDeps = {
    projectsDir,
    getProjectMemory: (portal: string) =>
      Promise.resolve({
        portal,
        overview: "",
        patterns: [{ name: "P", description: "D", examples: [], tags: ["t1"] }],
        decisions: [{ date: "2026-01-01", decision: "D1", rationale: "R1", tags: ["t1"] }],
        references: [],
      } as IProjectMemory),
    getExecutionHistory: () => Promise.resolve([]),
    loadLearningsFromFile: () =>
      Promise.resolve([
        createTestLearning({
          id: "550e8400-e29b-41d4-a716-446655440002",
          title: "T",
          description: "D",
          status: MemoryStatus.APPROVED,
          tags: ["t1"],
        }),
      ]),
    calculateFrequency: () => 0,
    calculateRelevance: () => 0.5,
  };

  const results = await searchByTags(["t1"], { portal: "projA", limit: 10 }, deps);
  const types = results.map((r) => r.type);
  assert(types.includes(MemoryType.PATTERN));
  assert(types.includes(MemoryType.DECISION));
  assert(types.includes(MemoryType.LEARNING));

  await Deno.remove(projectsDir, { recursive: true });
});

Deno.test("[regression] searchMemoryAdvanced combines tag and keyword results without duplicates", async () => {
  const projectsDir = await Deno.makeTempDir({ prefix: "exatest-" });
  await Deno.mkdir(`${projectsDir}/projA`);

  const deps: ISearchDeps = {
    projectsDir,
    getProjectMemory: () =>
      Promise.resolve({
        portal: "projA",
        overview: "contains zed",
        patterns: [{ name: "ZedPattern", description: "zed here", examples: [], tags: ["t1"] }],
        decisions: [],
        references: [],
      } as IProjectMemory),
    getExecutionHistory: () => Promise.resolve([]),
    loadLearningsFromFile: () => Promise.resolve([]),
    calculateFrequency: (text: string | undefined, keywordLower: string) => {
      if (!text) return 0;
      const matches = text.toLowerCase().match(new RegExp(keywordLower, "gi"));
      return matches ? matches.length : 0;
    },
    calculateRelevance: (titleFreq: number, descFreq: number) =>
      Math.min(0.99, 0.5 + (titleFreq * 0.15) + (descFreq * 0.05)),
  };

  const results = await searchMemoryAdvanced({ tags: ["t1"], keyword: "zed", portal: "projA", limit: 10 }, deps);
  // Should return one result for the pattern, not duplicated
  const patternResults = results.filter((r) => r.type === MemoryType.PATTERN && r.portal === "projA");
  assertEquals(patternResults.length, 1);

  await Deno.remove(projectsDir, { recursive: true });
});
