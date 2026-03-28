/**
 * @module ClarificationReEntryTest
 * @path tests/services/quality_gate/clarification_re_entry_test.ts
 * @description Tests the Q&A re-entry contract: `finalizeAndWritePending()`
 * helper, `shouldSkipRequest()` skip semantics for clarification statuses,
 * and the `assessed_at` re-assessment bypass in `RequestProcessor.process()`.
 * Directly covers Phase 47 Gap §1 (skip semantics) and Gap §2 (re-entry mechanism).
 * @architectural-layer Services
 * @dependencies [src/services/quality_gate/clarification_persistence.ts, src/services/request_processor.ts]
 * @related-files [src/services/quality_gate/clarification_persistence.ts, src/services/request_processor.ts, src/services/request_processing/types.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  ClarificationSessionStatus,
  type IClarificationSession,
} from "../../../src/shared/schemas/clarification_session.ts";
import type { IRequestSpecification } from "../../../src/shared/schemas/request_specification.ts";
import { finalizeAndWritePending } from "../../../src/services/quality_gate/clarification_persistence.ts";
import { RequestStatus } from "../../../src/shared/status/request_status.ts";
import { RequestProcessor } from "../../../src/services/request_processor.ts";
import { QualityGateMode, RequestSource } from "../../../src/shared/enums.ts";
import type { IRequestQualityGateService } from "../../../src/shared/interfaces/i_request_quality_gate_service.ts";
import type { IRequestQualityIssue } from "../../../src/shared/schemas/request_quality_assessment.ts";
import {
  type IRequestQualityAssessment,
  RequestQualityLevel,
  RequestQualityRecommendation,
} from "../../../src/shared/schemas/request_quality_assessment.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { createMockProvider } from "../../helpers/mock_provider.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "clari_reentry_test_" });
}

function makeRequestFile(
  dir: string,
  status: string,
  extraFields: Record<string, string> = {},
): string {
  const filePath = join(dir, "test_request.md");
  const extras = Object.entries(extraFields)
    .map(([k, v]) => `${k}: "${v}"`)
    .join("\n");

  const content = [
    "---",
    `trace_id: "test-trace"`,
    `created: "2026-01-01T00:00:00.000Z"`,
    `status: "${status}"`,
    `priority: "normal"`,
    `identity: "senior-coder"`,
    `source: ${RequestSource.CLI}`,
    `created_by: "tester"`,
    extras,
    "---",
    "Fix something",
  ].join("\n");

  Deno.writeTextFileSync(filePath, content);
  return filePath;
}

async function setupProcessorTestEnv(
  config: any,
  tempDir: string,
): Promise<{
  workspacePath: string;
  requestsDir: string;
  blueprintsPath: string;
  processorConfig: { workspacePath: string; requestsDir: string; blueprintsPath: string; includeReasoning: boolean };
}> {
  const workspacePath = join(tempDir, config.paths.workspace);
  const requestsDir = join(workspacePath, config.paths.requests);
  const blueprintsPath = join(tempDir, config.paths.blueprints, config.paths.identities);
  await Deno.mkdir(requestsDir, { recursive: true });
  await Deno.mkdir(blueprintsPath, { recursive: true });
  const processorConfig = { workspacePath, requestsDir, blueprintsPath, includeReasoning: false };
  return { workspacePath, requestsDir, blueprintsPath, processorConfig };
}

function writeTestRequestFile(
  filePath: string,
  options: { trace_id: string; status: string; body?: string; priority?: string; agent?: string },
): void {
  const { trace_id, status, body = "Fix something", priority = "normal", agent = "senior-coder" } = options;
  Deno.writeTextFileSync(
    filePath,
    [
      "---",
      `trace_id: "${trace_id}"`,
      `created: "2026-01-01T00:00:00.000Z"`,
      `status: "${status}"`,
      `priority: "${priority}"`,
      `identity: "${agent}"`,
      `source: ${RequestSource.CLI}`,
      `created_by: "tester"`,
      "---",
      body,
    ].join("\n"),
  );
}

function makeSession(requestId: string, status = ClarificationSessionStatus.AGENT_SATISFIED): IClarificationSession {
  return {
    requestId,
    originalBody: "Fix something in the system",
    rounds: [],
    status,
    qualityHistory: [{ round: 1, score: 75, level: "good" }],
    refinedBody: {
      summary: "Fix auth module",
      goals: ["Fix login bug"],
      successCriteria: ["Login endpoint returns 200"],
      scope: { includes: ["src/services/auth.ts"], excludes: [] },
      constraints: [],
      context: [],
      originalBody: "Fix something in the system",
    },
  };
}

function makeSpec(): IRequestSpecification {
  return {
    summary: "Fix auth module",
    goals: ["Fix login bug"],
    successCriteria: ["Login endpoint returns 200"],
    scope: { includes: ["src/services/auth.ts"], excludes: [] },
    constraints: [],
    context: [],
    originalBody: "Fix something in the system",
  };
}

// ---------------------------------------------------------------------------
// finalizeAndWritePending — file write behaviour
// ---------------------------------------------------------------------------

Deno.test("[ClarificationReEntry] finalizeAndWritePending writes status: pending to frontmatter", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = makeRequestFile(dir, RequestStatus.REFINING);
    const session = makeSession("req-001");
    const spec = makeSpec();

    await finalizeAndWritePending(filePath, session, spec);

    const content = await Deno.readTextFile(filePath);
    assertStringIncludes(content, "status: pending");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ClarificationReEntry] finalizeAndWritePending writes assessed_at to frontmatter", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = makeRequestFile(dir, RequestStatus.REFINING);
    const session = makeSession("req-002");
    const spec = makeSpec();

    await finalizeAndWritePending(filePath, session, spec);

    const content = await Deno.readTextFile(filePath);
    assertStringIncludes(content, "assessed_at:");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("[ClarificationReEntry] finalizeAndWritePending is atomic (no .tmp file remains)", async () => {
  const dir = await makeTempDir();
  try {
    const filePath = makeRequestFile(dir, RequestStatus.REFINING);
    const session = makeSession("req-003");
    const spec = makeSpec();

    await finalizeAndWritePending(filePath, session, spec);

    let tmpExists = false;
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name.endsWith(".tmp")) tmpExists = true;
    }
    assertEquals(tmpExists, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// shouldSkipRequest — skip semantics for clarification statuses
// (tested indirectly: process() returns early without modifying the file)
// ---------------------------------------------------------------------------

function buildMinimalProcessor(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  config: Awaited<ReturnType<typeof initTestDbService>>["config"],
  processorConfig: { workspacePath: string; requestsDir: string; blueprintsPath: string; includeReasoning: boolean },
  stubGate: IRequestQualityGateService,
): RequestProcessor {
  return new RequestProcessor(
    config,
    db,
    processorConfig,
    createMockProvider(["<content>{}</content>"]),
    undefined,
    undefined,
    undefined,
    stubGate,
  );
}

function makeNeverCalledGate(): IRequestQualityGateService {
  const gate: IRequestQualityGateService = {
    assess: () => {
      throw new Error("Gate should NOT have been called for skipped request");
    },
    startClarification: () => {
      throw new Error("Gate should NOT have been called for skipped request");
    },
    enrich: (_requestText: string, _issues: IRequestQualityIssue[]) => {
      throw new Error("Gate should NOT have been called for skipped request");
    },
    submitAnswers: () => {
      throw new Error("Gate should NOT have been called for skipped request");
    },
    isSessionComplete: () => {
      throw new Error("Gate should NOT have been called for skipped request");
    },
  };
  return gate;
}

// makeProceedGate not used in current tests — kept for future extension
const _makeProceedGate = (): IRequestQualityGateService => {
  const assessment: IRequestQualityAssessment = {
    score: 90,
    level: RequestQualityLevel.EXCELLENT,
    issues: [],
    recommendation: RequestQualityRecommendation.PROCEED,
    metadata: { assessedAt: new Date().toISOString(), mode: QualityGateMode.HEURISTIC, durationMs: 1 },
  };
  return {
    assess: () => Promise.resolve(assessment),
    startClarification: () => Promise.reject(new Error("no clarification in proceed mode")),
    enrich: () => Promise.resolve("enriched body text"),
    submitAnswers: () => Promise.reject(new Error("not needed")),
    isSessionComplete: () => false,
  };
};
void _makeProceedGate; // prevent unused-export lint error

Deno.test(
  "[ClarificationReEntry] shouldSkipRequest returns true for NEEDS_CLARIFICATION",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const { db, config, tempDir, cleanup } = await initTestDbService();
    try {
      const { requestsDir, processorConfig } = await setupProcessorTestEnv(config, tempDir);
      const filePath = join(requestsDir, "skip-nc.md");
      writeTestRequestFile(filePath, {
        trace_id: "trace-skip-nc",
        status: RequestStatus.NEEDS_CLARIFICATION,
        body: "Fix something",
      });

      const neverCalledGate = makeNeverCalledGate();
      const processor = await buildMinimalProcessor(db, config, processorConfig, neverCalledGate);

      // Must not throw (the gate `assess` would throw if called)
      await processor.process(filePath);

      // Status must remain NEEDS_CLARIFICATION (not changed)
      const after = await Deno.readTextFile(filePath);
      assertStringIncludes(after, `status: "${RequestStatus.NEEDS_CLARIFICATION}"`);
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "[ClarificationReEntry] shouldSkipRequest returns true for REFINING",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const { db, config, tempDir, cleanup } = await initTestDbService();
    try {
      const { requestsDir, processorConfig } = await setupProcessorTestEnv(config, tempDir);
      const filePath = join(requestsDir, "skip-ref.md");
      writeTestRequestFile(filePath, {
        trace_id: "trace-skip-ref",
        status: RequestStatus.REFINING,
        body: "Fix something",
      });

      const neverCalledGate = makeNeverCalledGate();
      const processor = await buildMinimalProcessor(db, config, processorConfig, neverCalledGate);

      await processor.process(filePath);

      const after = await Deno.readTextFile(filePath);
      assertStringIncludes(after, `status: "${RequestStatus.REFINING}"`);
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "[ClarificationReEntry] RequestProcessor skips quality gate re-assessment when assessed_at present",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const { db, config, tempDir, cleanup } = await initTestDbService();
    try {
      const workspacePath = join(tempDir, config.paths.workspace);
      const requestsDir = join(workspacePath, config.paths.requests);
      const blueprintsPath = join(tempDir, config.paths.blueprints, config.paths.identities);
      await Deno.mkdir(requestsDir, { recursive: true });
      await Deno.mkdir(blueprintsPath, { recursive: true });
      const processorConfig = { workspacePath, requestsDir, blueprintsPath, includeReasoning: false };

      const filePath = join(requestsDir, "bypass-gate.md");
      Deno.writeTextFileSync(
        filePath,
        [
          "---",
          `trace_id: "trace-bypass"`,
          `created: "2026-01-01T00:00:00.000Z"`,
          `status: "${RequestStatus.PENDING}"`,
          `priority: "normal"`,
          `identity: "nonexistent-agent"`,
          `source: ${RequestSource.CLI}`,
          `created_by: "tester"`,
          `assessed_at: "2026-01-01T00:00:00.000Z"`,
          "---",
          "Fix something in src/services/auth.ts to resolve the login bug",
        ].join("\n"),
      );

      let assessCalled = false;
      const spyGate: IRequestQualityGateService = {
        assess: () => {
          assessCalled = true;
          return Promise.resolve({
            score: 90,
            level: RequestQualityLevel.EXCELLENT,
            issues: [],
            recommendation: RequestQualityRecommendation.PROCEED,
            metadata: { assessedAt: new Date().toISOString(), mode: QualityGateMode.HEURISTIC, durationMs: 1 },
          });
        },
        startClarification: () => Promise.reject(new Error("not needed")),
        enrich: () => Promise.resolve("enriched text"),
        submitAnswers: () => Promise.reject(new Error("not needed")),
        isSessionComplete: () => false,
      };

      const processor = await buildMinimalProcessor(db, config, processorConfig, spyGate);
      await processor.process(filePath);

      // Gate should NOT have been called because assessed_at bypasses re-assessment
      assertEquals(assessCalled, false, "Quality gate should be bypassed when assessed_at is present");
    } finally {
      await cleanup();
    }
  },
);
