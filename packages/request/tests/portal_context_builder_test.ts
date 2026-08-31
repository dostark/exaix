/**
 * @module PortalContextBuilderTest
 * @path packages/request/tests/portal_context_builder_test.ts
 * @architectural-layer Services
 * @description Verifies PortalContextBuilder builds a file-listing context block
 * for a configured portal alias, and resolves portal knowledge context via the
 * knowledge service with graceful fallback to a capped summary. Direct unit
 * coverage for the extracted builder (god-object decomposition of
 * RequestProcessor).
 * @related-files [packages/request/src/portal_context_builder.ts, packages/request/src/processor.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildPortalKnowledgeSummary, PortalContextBuilder } from "@exaix/request";
import { createMockConfig, createMockEventLogger } from "@exaix/testing";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { PortalOperation } from "@exaix/core";
import { makeKnowledge, makeMockKnowledgeService } from "./request_test_helpers.ts";

async function makePortalTestSetup() {
  const testDir = await Deno.makeTempDir({ prefix: "exa_portal_context_test_" });
  await Deno.mkdir(join(testDir, "src"), { recursive: true });
  await Deno.writeTextFile(join(testDir, "README.md"), "# Test");
  await Deno.writeTextFile(join(testDir, "src", "main.ts"), "export {};");

  const config = createMockConfig(testDir, {
    portals: [{
      alias: "test-portal",
      target_path: testDir,
      default_branch: TEST_DEFAULT_BRANCH,
      identities_allowed: ["*"],
      operations: [PortalOperation.READ],
    }],
  });

  return { testDir, config };
}

Deno.test("[PortalContextBuilder.buildFileContext] returns null when no portalAlias given", async () => {
  const { testDir, config } = await makePortalTestSetup();
  const builder = new PortalContextBuilder({ config });
  try {
    const result = await builder.buildFileContext(undefined, createMockEventLogger());
    assertEquals(result, null);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[PortalContextBuilder.buildFileContext] returns null and warns when portal alias unknown", async () => {
  const { testDir, config } = await makePortalTestSetup();
  const builder = new PortalContextBuilder({ config });
  try {
    const result = await builder.buildFileContext("unknown-portal", createMockEventLogger());
    assertEquals(result, null);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[PortalContextBuilder.buildFileContext] lists files for a known portal alias", async () => {
  const { testDir, config } = await makePortalTestSetup();
  const builder = new PortalContextBuilder({ config });
  try {
    const result = await builder.buildFileContext("test-portal", createMockEventLogger());
    assertStringIncludes(result ?? "", "README.md");
    assertStringIncludes(result ?? "", "main.ts");
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[PortalContextBuilder.resolveKnowledgeContext] falls back to summary when no knowledge service configured", async () => {
  const { testDir, config } = await makePortalTestSetup();
  const builder = new PortalContextBuilder({ config });
  const knowledge = makeKnowledge();
  try {
    const result = await builder.resolveKnowledgeContext("body text", "test-portal", knowledge);
    assertEquals(result, buildPortalKnowledgeSummary(knowledge));
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[PortalContextBuilder.resolveKnowledgeContext] falls back to summary when portalAlias absent", async () => {
  const { testDir, config } = await makePortalTestSetup();
  const knowledgeService = makeMockKnowledgeService({ relevanceEnabled: true });
  const builder = new PortalContextBuilder({ config, portalKnowledgeService: knowledgeService });
  const knowledge = makeKnowledge();
  try {
    const result = await builder.resolveKnowledgeContext("body text", undefined, knowledge);
    assertEquals(result, buildPortalKnowledgeSummary(knowledge));
    assertEquals(knowledgeService.relevanceCalls.length, 0);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[PortalContextBuilder.resolveKnowledgeContext] uses relevance-based retrieval when available", async () => {
  const { testDir, config } = await makePortalTestSetup();
  const knowledgeService = makeMockKnowledgeService({ relevanceEnabled: true });
  const builder = new PortalContextBuilder({ config, portalKnowledgeService: knowledgeService });
  const knowledge = makeKnowledge();
  try {
    const result = await builder.resolveKnowledgeContext("body text", "test-portal", knowledge);
    assertEquals(result, "Relevant: TypeScript service with I-prefix interfaces");
    assertEquals(knowledgeService.relevanceCalls.length, 1);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[PortalContextBuilder.resolveKnowledgeContext] falls back to summary when getRelevantContext returns undefined", async () => {
  const { testDir, config } = await makePortalTestSetup();
  const knowledgeService = makeMockKnowledgeService({ relevanceEnabled: false });
  const builder = new PortalContextBuilder({ config, portalKnowledgeService: knowledgeService });
  const knowledge = makeKnowledge();
  try {
    const result = await builder.resolveKnowledgeContext("body text", "test-portal", knowledge);
    assertEquals(result, buildPortalKnowledgeSummary(knowledge));
    assertEquals(knowledgeService.relevanceCalls.length, 1);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[PortalContextBuilder.resolveKnowledgeContext] falls back to summary when getRelevantContext throws", async () => {
  const { testDir, config } = await makePortalTestSetup();
  const knowledgeService = makeMockKnowledgeService({ throwOnRelevance: true });
  const builder = new PortalContextBuilder({ config, portalKnowledgeService: knowledgeService });
  const knowledge = makeKnowledge();
  try {
    const result = await builder.resolveKnowledgeContext("body text", "test-portal", knowledge);
    assertEquals(result, buildPortalKnowledgeSummary(knowledge));
    assertEquals(knowledgeService.relevanceCalls.length, 1);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});
