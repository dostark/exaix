/**
 * @module KnowledgeInvalidationStrategyTest
 * @path packages/portal/knowledge/tests/knowledge_invalidation_strategy_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Unit tests for portal knowledge invalidation strategy.
 */

import { assertEquals } from "@std/assert";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import {
  type IGitHeadResolver,
  type IKnowledgeInvalidationStrategy,
  KnowledgeInvalidationStrategy,
} from "@exaix/portal/knowledge";

function makeKnowledge(overrides: Partial<IPortalKnowledge> = {}): IPortalKnowledge {
  return {
    portal: "test-portal",
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "# Test",
    layers: [],
    keyFiles: [],
    conventions: [],
    dependencies: [],
    packages: undefined,
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [],
    stats: {
      totalFiles: 0,
      totalDirectories: 0,
      extensionDistribution: {},
    },
    metadata: {
      durationMs: 0,
      mode: "quick",
      filesScanned: 0,
      filesRead: 0,
    },
    ...overrides,
  };
}

class FakeGitHeadResolver implements IGitHeadResolver {
  constructor(
    private readonly _currentSha: string | null,
    private readonly _changedFiles: string[] | null,
  ) {}

  resolve(_portalPath: string): Promise<string | null> {
    return Promise.resolve(this._currentSha);
  }

  changedFilesSince(_portalPath: string, _fromSha: string): Promise<string[] | null> {
    return Promise.resolve(this._changedFiles);
  }

  startWatching(): void {
    // No-op stub
  }

  stopWatching(): void {
    // No-op stub
  }
}

Deno.test("[KnowledgeInvalidationStrategy] skip when HEAD matches cached SHA", async () => {
  const cachedSha = "0123456789abcdef0123456789abcdef01234567";
  const strategy: IKnowledgeInvalidationStrategy = new KnowledgeInvalidationStrategy(
    new FakeGitHeadResolver(cachedSha, []),
  );

  const result = await strategy.check(
    "/tmp/test-portal",
    makeKnowledge({ headCommitSha: cachedSha }),
    168,
  );

  assertEquals(result.analysisMode, "skip");
  assertEquals(result.reason, "sha_match");
  assertEquals(result.isValid, true);
  assertEquals(result.currentSha, cachedSha);
  assertEquals(result.cachedSha, cachedSha);
});

Deno.test("[KnowledgeInvalidationStrategy] incremental when SHA mismatches and changed files are small", async () => {
  const strategy: IKnowledgeInvalidationStrategy = new KnowledgeInvalidationStrategy(
    new FakeGitHeadResolver("fedcba9876543210fedcba9876543210fedcba98", ["src/index.ts"]),
  );

  const result = await strategy.check(
    "/tmp/test-portal",
    makeKnowledge({ headCommitSha: "0123456789abcdef0123456789abcdef01234567" }),
    168,
  );

  assertEquals(result.analysisMode, "incremental");
  assertEquals(result.reason, "sha_mismatch");
  assertEquals(result.isValid, false);
  assertEquals(result.filesDelta, 1);
});

Deno.test("[KnowledgeInvalidationStrategy] full when SHA mismatches and changed file count exceeds threshold", async () => {
  const changedFiles = Array.from({ length: 21 }, (_v, index) => `file${index}.ts`);
  const strategy: IKnowledgeInvalidationStrategy = new KnowledgeInvalidationStrategy(
    new FakeGitHeadResolver("fedcba9876543210fedcba9876543210fedcba98", changedFiles),
  );

  const result = await strategy.check(
    "/tmp/test-portal",
    makeKnowledge({ headCommitSha: "0123456789abcdef0123456789abcdef01234567" }),
    168,
  );

  assertEquals(result.analysisMode, "full");
  assertEquals(result.reason, "sha_mismatch");
  assertEquals(result.isValid, false);
  assertEquals(result.filesDelta, 21);
});

Deno.test("[KnowledgeInvalidationStrategy] falls back to TTL when git lookup fails", async () => {
  const staleAt = new Date(Date.now() - 169 * 60 * 60 * 1000).toISOString();
  const strategy: IKnowledgeInvalidationStrategy = new KnowledgeInvalidationStrategy(
    new FakeGitHeadResolver(null, null),
  );

  const result = await strategy.check(
    "/tmp/test-portal",
    makeKnowledge({ headCommitSha: "0123456789abcdef0123456789abcdef01234567", gatheredAt: staleAt }),
    168,
  );

  assertEquals(result.analysisMode, "full");
  assertEquals(result.reason, "no_git");
  assertEquals(result.isValid, false);
});
