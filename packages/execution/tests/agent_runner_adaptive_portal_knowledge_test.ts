/**
 * @module AgentRunnerAdaptivePortalKnowledgeTest
 * @path packages/execution/tests/agent_runner_adaptive_portal_knowledge_test.ts
 * @description Phase 198 Step 3: with a real tokenizer/allocator, the directory-listing
 *   segment and adaptive portal-knowledge segment share the `portalKnowledge` section
 *   budget — a zero remainder adds no knowledge segment, a lower `max_tokens` clamps the
 *   assembled content, and the preview reports `portal_knowledge` tokens within the cap.
 *   A real EventLogger/SQLite `run()` journals one typed `portal.knowledge.selection_applied`
 *   event carrying the request's trace id and the final, post-`prepare()` included token
 *   count; `previewPrompt` performs the same assembly but journals nothing.
 * @architectural-layer Test
 * @related-files [
 *   "packages/execution/src/agent_runner.ts",
 *   "packages/core/src/func/portal_knowledge_selector.ts",
 *   "packages/core/src/prompt_budget_allocator.ts"
 * ]
 */

import { assert, assertEquals, assertLessOrEqual, assertNotEquals } from "@std/assert";
import { AgentRunner } from "@exaix/execution";
import type { IBlueprint, IParsedRequest } from "@exaix/execution";
import { MockProvider } from "@exaix/ai/providers.ts";
import { AiTokenEstimatorTokenizer } from "@exaix/core/func";
import { PORTAL_CONTEXT_KEY, PromptBudgetAllocator } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { initTestDbService } from "@exaix/testing";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";
const mockAgentBlueprint: IBlueprint = { systemPrompt: "You are a test agent." };

function makeKnowledge(): IPortalKnowledge {
  return {
    portal: "test-portal",
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "A TypeScript service codebase with a payment-routing layer.",
    layers: [],
    keyFiles: [{ path: "src/services/router.ts", role: "core-service", description: "Payment routing" }],
    conventions: [],
    dependencies: [],
    packages: undefined,
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [{
      name: "PaymentRouter",
      kind: "class",
      file: "src/services/router.ts",
      signature: "class PaymentRouter",
      doc: "Routes payment requests to providers",
    }],
    stats: { totalFiles: 5, totalDirectories: 2, extensionDistribution: { ".ts": 5 } },
    metadata: { durationMs: 10, mode: "quick" as IPortalKnowledge["metadata"]["mode"], filesScanned: 5, filesRead: 5 },
  };
}

function makeAdaptiveRequest(overrides: Partial<IParsedRequest> = {}): IParsedRequest {
  return {
    userPrompt: "Investigate PaymentRouter",
    context: { [PORTAL_CONTEXT_KEY]: "Directory: src/services/router.ts, src/services/auth.ts" },
    portalKnowledgeSnapshot: makeKnowledge(),
    ...overrides,
  };
}

function makeAdaptiveRunner(
  opts: { maxTokens: number; coreMaxTokens?: number; costTargetTokens?: number; logger?: EventLogger },
): AgentRunner {
  const tokenizer = new AiTokenEstimatorTokenizer();
  const promptBudgetAllocator = new PromptBudgetAllocator(
    opts.costTargetTokens !== undefined ? { costTargetTokens: opts.costTargetTokens } : undefined,
    tokenizer,
  );
  return new AgentRunner(new MockProvider(WELL_FORMED_RESPONSE), {
    tokenizer,
    promptBudgetAllocator,
    logger: opts.logger,
    context: {
      config: {
        get: () => ({
          portal_knowledge: {
            inclusion: "adaptive",
            max_tokens: opts.maxTokens,
            core_max_tokens: opts.coreMaxTokens ?? opts.maxTokens,
            relevant_max_entries: 20,
          },
        }),
      },
    } as never,
  });
}

Deno.test("[AgentRunner adaptive] the directory listing and adaptive knowledge share the section budget; preview reports portal_knowledge within the cap", async () => {
  const runner = makeAdaptiveRunner({ maxTokens: 3_000, costTargetTokens: 20_000 });
  const preview = await runner.previewPrompt(mockAgentBlueprint, makeAdaptiveRequest());

  const knowledgeSegments = preview.segments.filter((s) => s.kind === "portal_knowledge");
  assert(knowledgeSegments.length >= 1, "at least the directory-listing segment must be present");
  const adaptiveSegment = knowledgeSegments.find((s) => s.resultingTokenEstimate > 0 && s.included);
  assert(adaptiveSegment, "an adaptive knowledge segment should be included under a generous budget");
  assertLessOrEqual(adaptiveSegment.resultingTokenEstimate, 3_000);
});

Deno.test("[AgentRunner adaptive] a section budget fully consumed by the directory listing adds no adaptive knowledge segment", async () => {
  const runner = makeAdaptiveRunner({ maxTokens: 3_000, costTargetTokens: 20_000 });
  // A directory listing sized to exceed the entire ~3,600-token portalKnowledge section
  // (0.2 * ~18,000 usable tokens) leaves zero remainder for the adaptive builder.
  const hugeListing = "Directory: " + "src/file.ts, ".repeat(2_000);
  const request = makeAdaptiveRequest({ context: { [PORTAL_CONTEXT_KEY]: hugeListing } });

  const preview = await runner.previewPrompt(mockAgentBlueprint, request);
  const knowledgeSegments = preview.segments.filter((s) => s.kind === "portal_knowledge");
  // Only the directory-listing segment itself may be present; no second adaptive entry.
  assertEquals(knowledgeSegments.length, 1);
});

Deno.test("[AgentRunner adaptive] a lower max_tokens clamps the assembled content below a generous section budget", async () => {
  const generousRunner = makeAdaptiveRunner({ maxTokens: 3_000, costTargetTokens: 20_000 });
  const tightRunner = makeAdaptiveRunner({ maxTokens: 40, costTargetTokens: 20_000 });

  const generousPreview = await generousRunner.previewPrompt(mockAgentBlueprint, makeAdaptiveRequest());
  const tightPreview = await tightRunner.previewPrompt(mockAgentBlueprint, makeAdaptiveRequest());

  const generousAdaptive = generousPreview.segments.find((s) =>
    s.kind === "portal_knowledge" && s.resultingTokenEstimate > 0 && s.included
  );
  const tightAdaptive = tightPreview.segments.find((s) =>
    s.kind === "portal_knowledge" && s.resultingTokenEstimate > 0 && s.included &&
    s.resultingTokenEstimate <= 40
  );
  assert(generousAdaptive);
  assert(tightAdaptive, "the tight max_tokens run must clamp its adaptive segment to <= 40 tokens");
});

Deno.test("[AgentRunner adaptive] max_tokens clamps the effective runtime core even when core_max_tokens is set higher", async () => {
  const runner = makeAdaptiveRunner({ maxTokens: 40, coreMaxTokens: 3_000, costTargetTokens: 20_000 });
  const preview = await runner.previewPrompt(mockAgentBlueprint, makeAdaptiveRequest());

  const adaptiveSegment = preview.segments.find((s) =>
    s.kind === "portal_knowledge" && s.resultingTokenEstimate > 0 && s.included
  );
  assert(adaptiveSegment, "an adaptive knowledge segment should still be included");
  assertLessOrEqual(
    adaptiveSegment.resultingTokenEstimate,
    40,
    "max_tokens=40 must win over a larger core_max_tokens=3000",
  );
});

Deno.test("[AgentRunner adaptive] previewPrompt performs the same assembly but journals no selection event", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const runner = makeAdaptiveRunner({ maxTokens: 3_000, costTargetTokens: 20_000, logger });
    const traceId = crypto.randomUUID();

    await runner.previewPrompt(mockAgentBlueprint, makeAdaptiveRequest({ traceId }));
    await db.waitForFlush();

    const rows = db.getActivitiesByTrace(traceId);
    const selectionRow = rows.find((r) => r.action_type === DomainEventType.PortalKnowledgeSelectionApplied);
    assertEquals(selectionRow, undefined, "previewPrompt must not journal a selection event");
  } finally {
    await cleanup();
  }
});

Deno.test("[AgentRunner adaptive] a real run() journals one typed selection event with the request's trace id and final included token count", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const runner = makeAdaptiveRunner({ maxTokens: 3_000, costTargetTokens: 20_000, logger });
    const traceId = crypto.randomUUID();

    await runner.run(mockAgentBlueprint, makeAdaptiveRequest({ traceId }), undefined);
    await db.waitForFlush();

    const rows = db.getActivitiesByTrace(traceId);
    const selectionRows = rows.filter((r) => r.action_type === DomainEventType.PortalKnowledgeSelectionApplied);
    assertEquals(selectionRows.length, 1, "exactly one selection event must be journaled per real adaptive assembly");

    const payload = JSON.parse(selectionRows[0].payload) as {
      inclusion: string;
      includedTokens: number;
      selectedEntryIds: string[];
    };
    assertEquals(payload.inclusion, "adaptive");
    assertNotEquals(payload.includedTokens, 0);
    assert(payload.selectedEntryIds.length > 0);
  } finally {
    await cleanup();
  }
});
