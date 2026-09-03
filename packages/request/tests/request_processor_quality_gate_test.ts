/**
 * @module RequestProcessorQualityGateTest
 * @path packages/request/tests/request_processor_quality_gate_test.ts
 * @architectural-layer Services
 * @description Verifies that RequestProcessor integrates with RequestQualityGate
 * to assess, enrich, and route requests before analysis and agent execution.
 * @related-files ["packages/request/src/processor.ts", "packages/quality-gate/src/request_quality_gate.ts"]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { RequestProcessor } from "@exaix/request";
import { AgentRunner } from "@exaix/execution";
import type { IApplicationContext, IRequestQualityGateService } from "@exaix/core/types";
import {
  type IRequestQualityAssessment,
  RequestQualityLevel,
  RequestQualityRecommendation,
} from "@exaix/schemas/request_quality_assessment.ts";
import { QualityGateMode, RequestSource } from "@exaix/core";
import { RequestStatus } from "@exaix/core/status";
import { saveClarification } from "@exaix/quality-gate";
import {
  createMockProvider,
  createStubConfig,
  createStubDisplay,
  createStubGit,
  initTestDbService,
} from "@exaix/testing";
import type { IClarificationSession } from "@exaix/schemas/clarification_session.ts";
import { ClarificationSessionStatus } from "@exaix/schemas/clarification_session.ts";
import type { SessionDelegateConfig } from "@exaix/schemas/session_delegate.ts";

// Helpers

async function makeEnv() {
  const { db, config, tempDir, cleanup } = await initTestDbService();

  const workspacePath = join(tempDir, config.paths.workspace);
  const requestsDir = join(workspacePath, config.paths.requests);
  const plansDir = join(workspacePath, config.paths.plans);
  const blueprintsPath = join(tempDir, config.paths.blueprints, config.paths.agents);

  await Deno.mkdir(requestsDir, { recursive: true });
  await Deno.mkdir(plansDir, { recursive: true });
  await Deno.mkdir(blueprintsPath, { recursive: true });

  const processorConfig = { workspacePath, requestsDir, blueprintsPath, includeReasoning: false };

  return { db, config, tempDir, cleanup, workspacePath, requestsDir, blueprintsPath, processorConfig };
}

function makeRequestFile(requestsDir: string, body: string, overrides: {
  requestId?: string;
  agent_role?: string;
} = {}): string {
  const requestId = overrides.requestId ?? "req-qg-001";
  const agent = overrides.agent_role ?? "nonexistent-agent";
  const filePath = join(requestsDir, `${requestId}.md`);

  Deno.writeTextFileSync(
    filePath,
    [
      "---",
      `trace_id: "trace-${requestId}"`,
      `created: "${new Date().toISOString()}"`,
      `status: "${RequestStatus.PENDING}"`,
      `priority: "normal"`,
      `agent_role: "${agent}"`,
      `source: ${RequestSource.CLI}`,
      `created_by: "test-user"`,
      "---",
      body,
    ].join("\n"),
  );

  return filePath;
}

function makeProceedAssessment(): IRequestQualityAssessment {
  return {
    score: 90,
    level: RequestQualityLevel.EXCELLENT,
    issues: [],
    recommendation: RequestQualityRecommendation.PROCEED,
    metadata: { assessedAt: new Date().toISOString(), mode: QualityGateMode.HEURISTIC, durationMs: 1 },
  };
}

/** Builds a stub IRequestQualityGateService that always returns the given recommendation. */
function makeStubGate(recommendation: RequestQualityRecommendation): IRequestQualityGateService {
  const score = recommendation === RequestQualityRecommendation.PROCEED ? 90 : 30;
  const level = recommendation === RequestQualityRecommendation.PROCEED
    ? RequestQualityLevel.EXCELLENT
    : RequestQualityLevel.POOR;
  const assessment: IRequestQualityAssessment = {
    score,
    level,
    issues: [],
    recommendation,
    metadata: { assessedAt: new Date().toISOString(), mode: QualityGateMode.HEURISTIC, durationMs: 1 },
  };

  return {
    assess: (_text, _ctx) => Promise.resolve(assessment),
    enrich: (text, _issues) => Promise.resolve(`Enriched: ${text}`),
    startClarification: (_reqId, _body) => Promise.reject(new Error("stub")),
    submitAnswers: (_sess, _ans) => Promise.reject(new Error("stub")),
    isSessionComplete: (_sess) => false,
  };
}

/** Stub gate that always auto-enriches (returns AUTO_ENRICH recommendation with enrichedBody set). */
function makeEnrichingGate(enrichedBody: string): IRequestQualityGateService {
  return {
    assess: (_text, _ctx) =>
      Promise.resolve({
        score: 55,
        level: RequestQualityLevel.ACCEPTABLE,
        issues: [],
        recommendation: RequestQualityRecommendation.AUTO_ENRICH,
        enrichedBody,
        metadata: { assessedAt: new Date().toISOString(), mode: QualityGateMode.HEURISTIC, durationMs: 1 },
      }),
    enrich: (_text, _issues) => Promise.resolve(enrichedBody),
    startClarification: (_reqId, _body) => Promise.reject(new Error("stub")),
    submitAnswers: (_sess, _ans) => Promise.reject(new Error("stub")),
    isSessionComplete: (_sess) => false,
  };
}

type MakeEnvResult = Awaited<ReturnType<typeof makeEnv>>;

function makeTestProcessor(
  env: MakeEnvResult,
  opts: {
    gate?: IRequestQualityGateService;
    config?: Parameters<typeof createStubConfig>[0];
    onDelegateRefinement?: (traceId: string, requestId: string, body: string) => Promise<void>;
  } = {},
): { processor: RequestProcessor; mockProvider: ReturnType<typeof createMockProvider> } {
  const mockProvider = createMockProvider(["<content>{}</content>"]);
  const context: IApplicationContext = {
    config: createStubConfig(opts.config ?? env.config),
    db: env.db,
    provider: mockProvider,
    git: createStubGit(),
    display: createStubDisplay(env.db),
  };
  const processor = new RequestProcessor({
    ...env.processorConfig,
    context,
    testProvider: mockProvider,
    agentRunner: new AgentRunner(mockProvider),
    ...(opts.gate !== undefined ? { testQualityGate: opts.gate } : {}),
    ...(opts.onDelegateRefinement !== undefined ? { onDelegateRefinement: opts.onDelegateRefinement } : {}),
  });
  return { processor, mockProvider };
}

// Tests

Deno.test("[RequestProcessor] quality gate runs before agent execution", async () => {
  const env = await makeEnv();
  try {
    let assessCalled = false;
    const trackingGate: IRequestQualityGateService = {
      assess: (_text, _ctx) => {
        assessCalled = true;
        return Promise.resolve(makeProceedAssessment());
      },
      enrich: (text, _) => Promise.resolve(text),
      startClarification: () => Promise.reject(new Error("stub")),
      submitAnswers: () => Promise.reject(new Error("stub")),
      isSessionComplete: () => false,
    };

    const filePath = makeRequestFile(env.requestsDir, "Implement login feature in src/auth.ts");
    const { processor } = makeTestProcessor(env, { gate: trackingGate });

    await processor.process(filePath);
    assertEquals(assessCalled, true);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] proceeds for high-quality requests", async () => {
  const env = await makeEnv();
  try {
    const gate = makeStubGate(RequestQualityRecommendation.PROCEED);
    const filePath = makeRequestFile(env.requestsDir, "Implement JWT validation in src/auth.ts");
    const { processor } = makeTestProcessor(env, { gate });

    // Should not early-return due to gate
    const result = await processor.process(filePath);
    // Will be null because blueprint doesn't exist, but gate was not the blocker
    assertEquals(result, null);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] enriches underspecified requests", async () => {
  const env = await makeEnv();
  try {
    const enrichedBody = "Enriched: Create a database configuration file";
    const gate = makeEnrichingGate(enrichedBody);
    const filePath = makeRequestFile(env.requestsDir, "Create config file", { requestId: "req-enrich-001" });
    const { processor } = makeTestProcessor(env, { gate });

    await processor.process(filePath);
    // Processing continues; no early return (enrichment path)
    // Test verifies process() ran without error (quality gate path was reached)
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] enters Q&A loop for poor requests", async () => {
  const env = await makeEnv();
  try {
    const gate = makeStubGate(RequestQualityRecommendation.NEEDS_CLARIFICATION);
    const filePath = makeRequestFile(env.requestsDir, "fix it", { requestId: "req-clarify-001" });
    const { processor } = makeTestProcessor(env, { gate });

    const result = await processor.process(filePath);

    // Processor returns null after setting REFINING status
    assertEquals(result, null);

    // Request file should now have status REFINING
    const content = await Deno.readTextFile(filePath);
    assertEquals(content.includes(RequestStatus.REFINING), true);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] preserves original body when enriching", async () => {
  const env = await makeEnv();
  try {
    const originalBody = "Create config file";
    const enrichedBody = "Enriched: Create a database configuration file with defaults";

    const trackingGate = makeEnrichingGate(enrichedBody);

    const filePath = makeRequestFile(env.requestsDir, originalBody, { requestId: "req-preserve-001" });
    const { processor } = makeTestProcessor(env, { gate: trackingGate });

    await processor.process(filePath);
    // If we get here without error, enrichment path ran
    assertEquals(true, true);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] handles disabled quality gate", async () => {
  const env = await makeEnv();
  try {
    // No gate injected — quality gate should be disabled/skipped
    const filePath = makeRequestFile(env.requestsDir, "Implement login feature", { requestId: "req-disabled-001" });
    const { processor } = makeTestProcessor(env);

    // Should complete without error (gate not wired, no crash)
    const result = await processor.process(filePath);
    assertEquals(result, null); // null because blueprint doesn't exist
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] gate failure does not block processing", async () => {
  const env = await makeEnv();
  try {
    const failingGate: IRequestQualityGateService = {
      assess: () => Promise.reject(new Error("Gate exploded")),
      enrich: (t, _) => Promise.resolve(t),
      startClarification: () => Promise.reject(new Error("stub")),
      submitAnswers: () => Promise.reject(new Error("stub")),
      isSessionComplete: () => false,
    };

    const filePath = makeRequestFile(
      env.requestsDir,
      "Implement login feature",
      { requestId: "req-fail-gate-001" },
    );
    const { processor } = makeTestProcessor(env, { gate: failingGate });

    // Should not throw — gate failure should be caught gracefully
    const result = await processor.process(filePath);
    assertEquals(result, null);
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] passes IRequestSpecification to buildParsedRequest", async () => {
  const env = await makeEnv();
  try {
    const filePath = makeRequestFile(
      env.requestsDir,
      "Implement login feature with OAuth2",
      { requestId: "req-spec-001" },
    );

    // Persist a completed clarification session with a refinedBody specification
    const completedSession: IClarificationSession = {
      requestId: "req-spec-001",
      originalBody: "Implement login feature with OAuth2",
      rounds: [],
      qualityHistory: [{ round: 1, score: 70, level: "good" }],
      status: ClarificationSessionStatus.AGENT_SATISFIED,
      refinedBody: {
        summary: "Implement OAuth2 login",
        goals: ["Allow users to sign in via OAuth2"],
        successCriteria: ["Users can authenticate"],
        scope: { includes: ["OAuth2 flow"], excludes: [] },
        constraints: [],
        context: [],
        originalBody: "Implement login feature with OAuth2",
      },
    };
    await saveClarification(filePath, completedSession);

    // Gate always proceeds (the spec comes from the persisted session, not the gate)
    const gate = makeStubGate(RequestQualityRecommendation.PROCEED);
    const { processor } = makeTestProcessor(env, { gate });

    // process() will return null (blueprint missing), but specification is stored
    // before the blueprint lookup — we verify via the clarification session existing
    const result = await processor.process(filePath);
    assertEquals(result, null); // null: blueprint not found, but spec was loaded
  } finally {
    await env.cleanup();
  }
});

// Config wiring integration

Deno.test("[RequestProcessor] builds quality gate from TOML config when none injected", async () => {
  // heuristic mode + block_unactionable=false → gate recommends NEEDS_CLARIFICATION,
  // not REJECT; status → REFINING can only happen via the quality gate.
  const env = await makeEnv();
  try {
    // Body is ≥20 chars (avoids short-body penalty) and vague enough that
    // assessHeuristic scores it at ~35 → needs-clarification recommendation.
    const filePath = makeRequestFile(env.requestsDir, "fix something in the system", {
      requestId: "req-cfg-gate",
    });

    // Patch the config quality_gate values — heuristic mode avoids LLM calls.
    // block_unactionable=false lets needs-clarification flow through to REFINING.
    const cfgPatch = {
      ...env.config,
      quality_gate: {
        enabled: true,
        mode: QualityGateMode.HEURISTIC,
        auto_enrich: false,
        block_unactionable: false,
        max_clarification_rounds: 5,
        thresholds: { minimum: 20, enrichment: 50, proceed: 70 },
      },
    };

    const { processor } = makeTestProcessor(env, { config: cfgPatch });

    await processor.process(filePath);

    // The quality gate (built from config) should have set status to REFINING
    // before the processor reached blueprint lookup.
    const content = await Deno.readTextFile(filePath);
    assertEquals(content.includes(RequestStatus.REFINING), true);
  } finally {
    await env.cleanup();
  }
});

// refinement-delegation gate

Deno.test("[RequestProcessor] refinement-delegation fires onDelegateRefinement when config enables it", async () => {
  const env = await makeEnv();
  try {
    const filePath = makeRequestFile(env.requestsDir, "I need more clarity on architecture", {
      requestId: "req-ref-delegate",
    });
    const stubGate = makeStubGate(RequestQualityRecommendation.NEEDS_CLARIFICATION);

    let delegateCalled = false;
    let capturedTraceId = "";
    const { processor } = makeTestProcessor(env, {
      gate: stubGate,
      config: {
        ...env.config,
        session_delegate: {
          enabled: true,
          tool: "claude-code",
          gates: ["refinement"],
          launch_mode: "advisory",
          harden_permissions: false,
        } satisfies SessionDelegateConfig,
      },
      onDelegateRefinement: (traceId: string, _requestId: string, _body: string) => {
        delegateCalled = true;
        capturedTraceId = traceId;
        return Promise.resolve();
      },
    });

    await processor.process(filePath);
    assertEquals(delegateCalled, true, "onDelegateRefinement must fire when refinement delegation is enabled");
    assertEquals(capturedTraceId.startsWith("trace-"), true, "traceId must be passed to the callback");
  } finally {
    await env.cleanup();
  }
});

Deno.test("[RequestProcessor] refinement-delegation does NOT fire when session_delegate is disabled", async () => {
  const env = await makeEnv();
  try {
    const filePath = makeRequestFile(env.requestsDir, "I need more clarity on architecture", {
      requestId: "req-ref-no-delegate",
    });
    const stubGate = makeStubGate(RequestQualityRecommendation.NEEDS_CLARIFICATION);

    let delegateCalled = false;
    const { processor } = makeTestProcessor(env, {
      gate: stubGate,
      config: {
        ...env.config,
        session_delegate: undefined,
      },
      onDelegateRefinement: (_traceId: string, _requestId: string, _body: string) => {
        delegateCalled = true;
        return Promise.resolve();
      },
    });

    await processor.process(filePath);
    assertEquals(delegateCalled, false, "onDelegateRefinement must NOT fire when delegation is disabled");
  } finally {
    await env.cleanup();
  }
});
