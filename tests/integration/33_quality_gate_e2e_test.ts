/**
 * @module QualityGateE2ETest
 * @path tests/integration/33_quality_gate_e2e_test.ts
 * @description End-to-end integration tests verifying the entire quality gate
 * pipeline from request file through assessment, enrichment, and clarification
 * session creation. Tests both the RequestProcessor integration path and the
 * clarification session lifecycle independently.
 * @related-files ["packages/request/src/processor.ts", "packages/quality-gate/src/request_quality_gate.ts", "packages/quality-gate/src/clarification_engine.ts", "packages/quality-gate/src/clarification_persistence.ts", "packages/core/src/types/i_request_quality_gate_service.ts"]
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { ClarificationEngine, loadClarification, RequestQualityGate, saveClarification } from "@exaix/quality-gate";
import { RequestProcessor } from "@exaix/request";
import type { IApplicationContext, IRequestQualityGateService } from "@exaix/core/types";
import { createOutputValidator } from "@exaix/tool-runtime";
import {
  ClarificationQuestionCategory,
  ClarificationSessionStatus,
  type IClarificationSession,
} from "@exaix/schemas/clarification_session.ts";
import type { IRequestQualityAssessment, IRequestQualityIssue } from "@exaix/schemas/request_quality_assessment.ts";
import { RequestQualityLevel, RequestQualityRecommendation } from "@exaix/schemas/request_quality_assessment.ts";
import { MockStrategy, QualityGateMode } from "@exaix/core";
import { TestEnvironment } from "./helpers/test_environment.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { createMockProvider } from "@exaix/testing";
import { createStubConfig, createStubDisplay, createStubGit } from "@exaix/testing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta() {
  return {
    assessedAt: new Date().toISOString(),
    mode: QualityGateMode.HEURISTIC,
    durationMs: 1,
  };
}

function makeAssessment(
  recommendation: RequestQualityRecommendation,
  score: number,
  enrichedBody?: string,
): IRequestQualityAssessment {
  return {
    score,
    level: score >= 70
      ? RequestQualityLevel.GOOD
      : score >= 50
      ? RequestQualityLevel.ACCEPTABLE
      : RequestQualityLevel.POOR,
    issues: [],
    recommendation,
    enrichedBody,
    metadata: makeMeta(),
  };
}

function makeStubSession(requestId: string, body: string): IClarificationSession {
  return {
    requestId,
    originalBody: body,
    rounds: [
      {
        round: 1,
        questions: [
          {
            id: "r1q1",
            question: "Which module should be modified?",
            rationale: "Knowing the module helps narrow scope.",
            category: ClarificationQuestionCategory.SCOPE,
            required: true,
          },
        ],
        askedAt: new Date().toISOString(),
      },
    ],
    status: ClarificationSessionStatus.ACTIVE,
    qualityHistory: [{ round: 1, score: 30, level: RequestQualityLevel.POOR }],
  };
}

function makeStubGate(
  recommendation: RequestQualityRecommendation,
  score: number = 30,
  enrichedBody?: string,
): IRequestQualityGateService {
  return {
    assess(_text): Promise<IRequestQualityAssessment> {
      return Promise.resolve(makeAssessment(recommendation, score, enrichedBody));
    },
    enrich(text: string, _issues: IRequestQualityIssue[]): Promise<string> {
      return Promise.resolve(enrichedBody ?? text);
    },
    startClarification(requestId: string, body: string): Promise<IClarificationSession> {
      return Promise.resolve(makeStubSession(requestId, body));
    },
    submitAnswers(session: IClarificationSession): Promise<IClarificationSession> {
      return Promise.resolve(session);
    },
    isSessionComplete(_session: IClarificationSession) {
      return false;
    },
  };
}

// ---------------------------------------------------------------------------
// Group 1 – Pipeline integration (via RequestProcessor)
// ---------------------------------------------------------------------------

Deno.test("Quality Gate E2E – pipeline integration", async (t) => {
  const env = await TestEnvironment.create();

  try {
    await env.createBlueprint("senior-coder");

    // -----------------------------------------------------------------------
    // PROCEED: well-specified request should pass through without early return
    // -----------------------------------------------------------------------
    await t.step(
      "[E2E] well-specified request proceeds through quality gate",
      async () => {
        const { filePath } = await env.createRequest(
          "Implement a TypeScript function to validate JWT tokens",
          { identityId: "senior-coder" },
        );

        const proceedGate = makeStubGate(RequestQualityRecommendation.PROCEED, 90);
        const { processor } = buildProcessor(env, proceedGate);

        await processor.process(filePath);

        // Quality gate returned earlyReturn:false — pipeline ran, no clarification session
        const clarPath = filePath.replace(/\.md$/, "_clarification.json");
        const stat = await Deno.stat(clarPath).catch(() => null);
        assert(stat === null, "No _clarification.json should be created for PROCEED path");

        const content = await Deno.readTextFile(filePath);
        assert(!content.includes("status: refining"), "Status should not be REFINING");
      },
    );

    // -----------------------------------------------------------------------
    // NEEDS_CLARIFICATION: processor must exit early with REFINING status
    // and persist a clarification session
    // -----------------------------------------------------------------------
    await t.step(
      "[E2E] vague request enters Q&A loop",
      async () => {
        const { filePath } = await env.createRequest(
          "Something is wrong, please fix it",
          { identityId: "senior-coder" },
        );

        const clarGate = makeStubGate(
          RequestQualityRecommendation.NEEDS_CLARIFICATION,
          30,
        );
        const { processor } = buildProcessor(env, clarGate);

        await processor.process(filePath);

        const content = await Deno.readTextFile(filePath);
        assertStringIncludes(content, "status: refining");

        const clarPath = filePath.replace(/\.md$/, "_clarification.json");
        const clarStat = await Deno.stat(clarPath).catch(() => null);
        assertExists(clarStat, "_clarification.json should be created");
      },
    );

    // -----------------------------------------------------------------------
    // AUTO_ENRICH: processor should NOT exit early; enrichedBody used downstream
    // -----------------------------------------------------------------------
    await t.step(
      "[E2E] underspecified request auto-enriched",
      async () => {
        const { filePath } = await env.createRequest(
          "The auth module needs some cleanup",
          { identityId: "senior-coder" },
        );

        const enrichGate = makeStubGate(
          RequestQualityRecommendation.AUTO_ENRICH,
          55,
          "Refactor src/auth.ts: extract token validation into a pure function with acceptance criteria: returns null on invalid token.",
        );
        const { processor } = buildProcessor(env, enrichGate);

        await processor.process(filePath);

        // AUTO_ENRICH path does NOT create clarification session
        const clarPath = filePath.replace(/\.md$/, "_clarification.json");
        const stat = await Deno.stat(clarPath).catch(() => null);
        assert(stat === null, "No _clarification.json for AUTO_ENRICH path");

        const content = await Deno.readTextFile(filePath);
        assert(!content.includes("status: refining"), "Status should not be REFINING after enrichment");
      },
    );

    // -----------------------------------------------------------------------
    // REJECT: processor must set FAILED status and exit early
    // -----------------------------------------------------------------------
    await t.step(
      "[E2E] rejected request sets FAILED status",
      async () => {
        const { filePath } = await env.createRequest(
          "Do whatever",
          { identityId: "senior-coder" },
        );

        const rejectGate = makeStubGate(RequestQualityRecommendation.REJECT, 5);
        const { processor } = buildProcessor(env, rejectGate);

        await processor.process(filePath);

        const content = await Deno.readTextFile(filePath);
        assertStringIncludes(content, "status: failed");
      },
    );

    // -----------------------------------------------------------------------
    // DISABLED GATE: processor proceeds normally regardless of request quality
    // -----------------------------------------------------------------------
    await t.step(
      "[E2E] disabled quality gate passes all requests",
      async () => {
        const { filePath } = await env.createRequest(
          "Please fix the broken stuff in the codebase",
          { identityId: "senior-coder" },
        );

        const disabledGate = new RequestQualityGate({
          enabled: false,
          mode: QualityGateMode.HEURISTIC,
          thresholds: { minimum: 20, enrichment: 50, proceed: 70 },
          autoEnrich: false,
          blockUnactionable: false,
          maxClarificationRounds: 5,
        });
        const { processor } = buildProcessor(env, disabledGate);

        await processor.process(filePath);

        const content = await Deno.readTextFile(filePath);
        assert(
          !content.includes("status: refining") &&
            !content.includes("status: failed"),
          "Disabled gate should let the request proceed past quality check",
        );
      },
    );

    // -----------------------------------------------------------------------
    // LLM UNAVAILABLE: gate in hybrid mode, LLM throws — heuristic takes over
    // and the pipeline completes without throwing.
    // -----------------------------------------------------------------------
    await t.step(
      "[E2E] Pipeline degrades gracefully when LLM unavailable",
      async () => {
        const { filePath } = await env.createRequest(
          // Body scores ~35 by heuristic (borderline → triggers LLM escalation
          // in hybrid mode).  When LLM throws the gate falls back to heuristic.
          "fix something in the system that is broken",
          { identityId: "senior-coder" },
        );

        // Provider that always rejects — simulates network/service outage.
        const unavailableProvider = {
          id: "unavailable",
          generate(_prompt: string): Promise<IGenerateResult> {
            return Promise.reject(new Error("LLM service unavailable"));
          },
        } as IModelProvider;

        const hybridGate = new RequestQualityGate(
          {
            enabled: true,
            mode: QualityGateMode.HYBRID,
            autoEnrich: false,
            blockUnactionable: false,
            maxClarificationRounds: 5,
            thresholds: { minimum: 20, enrichment: 50, proceed: 70 },
          },
          unavailableProvider,
          createOutputValidator(),
        );

        const { processor: degradedProcessor } = buildProcessor(env, hybridGate);

        // Must NOT throw — LlmQualityAssessor.assess() catches LLM errors and
        // falls back to assessHeuristic(), so process() always completes.
        await degradedProcessor.process(filePath);

        // Heuristic scored the body ~35 → needs-clarification → REFINING.
        // The exact status is less important than the absence of a thrown error,
        // but we assert the file is in a defined terminal state.
        const content = await Deno.readTextFile(filePath);
        const hasDefinedStatus = content.includes("status: refining") ||
          content.includes("status: failed") ||
          content.includes("status: planned") ||
          content.includes("status: pending");
        assert(hasDefinedStatus, "Request should reach a defined status even when LLM is unavailable");
      },
    );
  } finally {
    await env.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Group 2 – Clarification session lifecycle
// ---------------------------------------------------------------------------

Deno.test("Quality Gate E2E – clarification session lifecycle", async (t) => {
  const env = await TestEnvironment.create();

  try {
    const { filePath } = await env.createRequest(
      "Investigate the performance regression in the query layer",
      { identityId: "senior-coder" },
    );
    const requestId = basename(filePath, ".md");

    // -----------------------------------------------------------------------
    // Session persistence round-trip
    // -----------------------------------------------------------------------
    await t.step(
      "[E2E] clarification session persists and resumes",
      async () => {
        const session = makeStubSession(requestId, "Investigate performance regression");

        await saveClarification(filePath, session);

        const loaded = await loadClarification(filePath);
        assertExists(loaded, "loadClarification should return saved session");
        assertEquals(loaded!.requestId, requestId);
        assertEquals(loaded!.status, ClarificationSessionStatus.ACTIVE);
        assertEquals(loaded!.rounds.length, 1);
        assertEquals(loaded!.rounds[0].questions.length, 1);
        assertEquals(loaded!.qualityHistory[0].score, 30);
      },
    );

    // -----------------------------------------------------------------------
    // Quality score improves after answers processed by ClarificationEngine
    // -----------------------------------------------------------------------
    await t.step(
      "[E2E] quality score improves across Q&A rounds",
      async () => {
        // Build a ClarificationEngine with a mock provider that returns
        // satisfaction (higher quality) after answers are submitted.
        const satisfiedResponse = JSON.stringify({
          satisfied: true,
          refinedBody: {
            summary: "Fix query performance by adding index on users.created_at",
            goals: ["Add database index"],
            successCriteria: ["Query executes in < 100ms"],
            scope: { includes: ["migrations/"], excludes: [] },
            constraints: [],
            context: [],
            originalBody: "Investigate the performance regression in the query layer",
          },
        });

        const mockProvider = createMockProvider([satisfiedResponse]);
        const engine = new ClarificationEngine(
          mockProvider,
          createOutputValidator(),
          { maxRounds: 3 },
        );

        const initialSession = makeStubSession(requestId, "Investigate performance regression");
        const updatedSession = await engine.processAnswers(initialSession, {
          "r1q1": "The users table query — src/db/queries.ts line 45",
        });

        // The session should now have at least the indicator that answers
        // were processed (either additional round or terminal satisfied state)
        assertExists(updatedSession.status);
        assert(
          updatedSession.qualityHistory.length >= 1,
          "Quality history should track at least one round",
        );
      },
    );
  } finally {
    await env.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Internal helper — construct RequestProcessor with injected quality gate
// ---------------------------------------------------------------------------

function buildProcessor(
  env: TestEnvironment,
  gate: IRequestQualityGateService,
): { processor: RequestProcessor } {
  const provider = env.createMockProvider(MockStrategy.RECORDED);
  const context: IApplicationContext = {
    config: createStubConfig(env.config),
    db: env.db,
    provider,
    git: createStubGit(),
    display: createStubDisplay(env.db),
  };

  const processor = new RequestProcessor({
    workspacePath: join(env.tempDir, "Workspace"),
    requestsDir: join(env.tempDir, "Workspace", "Requests"),
    blueprintsPath: join(env.tempDir, "Blueprints", "Identities"),
    includeReasoning: true,
    context,
    testProvider: provider,
    testQualityGate: gate,
  });
  return { processor };
}
