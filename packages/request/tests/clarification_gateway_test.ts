/**
 * @module ClarificationGatewayTest
 * @path packages/request/tests/clarification_gateway_test.ts
 * @architectural-layer Services
 * @description Verifies ClarificationGateway evaluates the quality gate and
 * routes requests to rejection, refinement delegation, or a clarification
 * session, or loads a previously-completed clarification's specification when
 * bypassing re-assessment. Direct unit coverage for the extracted gateway
 * (god-object decomposition of RequestProcessor).
 * @related-files [packages/request/src/clarification_gateway.ts, packages/request/src/processor.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ClarificationGateway, StatusManager } from "@exaix/request";
import { createMockEventLogger } from "@exaix/testing";
import { RequestStatus } from "@exaix/core/status";
import { QualityGateMode } from "@exaix/core";
import {
  type IRequestQualityAssessment,
  RequestQualityLevel,
  RequestQualityRecommendation,
} from "@exaix/schemas/request_quality_assessment.ts";
import type { IRequestQualityGateService } from "@exaix/core/types";
import type { IClarificationSession } from "@exaix/schemas/clarification_session.ts";
import { ClarificationSessionStatus } from "@exaix/schemas/clarification_session.ts";
import { saveClarification } from "@exaix/quality-gate";

function makeStubGate(
  recommendation: RequestQualityRecommendation,
  overrides: Partial<IRequestQualityAssessment> = {},
): IRequestQualityGateService {
  const assessment: IRequestQualityAssessment = {
    score: 50,
    level: RequestQualityLevel.ACCEPTABLE,
    issues: [],
    recommendation,
    metadata: { assessedAt: new Date().toISOString(), mode: QualityGateMode.HEURISTIC, durationMs: 1 },
    ...overrides,
  };

  return {
    assess: (_text, _ctx) => Promise.resolve(assessment),
    enrich: (text, _issues) => Promise.resolve(`Enriched: ${text}`),
    startClarification: (_reqId, _body) =>
      Promise.resolve({
        requestId: _reqId,
        originalBody: _body,
        rounds: [],
        qualityHistory: [],
        status: ClarificationSessionStatus.ACTIVE,
      } as IClarificationSession),
    submitAnswers: (_sess, _ans) => Promise.reject(new Error("stub")),
    isSessionComplete: (_sess) => false,
  };
}

async function makeRequestFile(): Promise<{ testDir: string; filePath: string }> {
  const testDir = await Deno.makeTempDir({ prefix: "exa_clarification_gateway_test_" });
  const filePath = join(testDir, "req-1.md");
  await Deno.writeTextFile(
    filePath,
    ["---", `status: "${RequestStatus.PENDING}"`, "---", "Do the thing."].join("\n"),
  );
  return { testDir, filePath };
}

Deno.test("[ClarificationGateway.runQualityGate] no quality gate configured: loads completed clarification spec", async () => {
  const { testDir, filePath } = await makeRequestFile();
  const statusManager = new StatusManager(createMockEventLogger());
  const gateway = new ClarificationGateway({ statusManager });
  try {
    const result = await gateway.runQualityGate("body", filePath, "req-1", createMockEventLogger(), "trace-1");
    assertEquals(result, { earlyReturn: false, specification: undefined });
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[ClarificationGateway.runQualityGate] REJECT recommendation marks request FAILED and returns early", async () => {
  const { testDir, filePath } = await makeRequestFile();
  const statusManager = new StatusManager(createMockEventLogger());
  const qualityGate = makeStubGate(RequestQualityRecommendation.REJECT);
  const gateway = new ClarificationGateway({ statusManager, qualityGate });
  try {
    const result = await gateway.runQualityGate("body", filePath, "req-1", createMockEventLogger(), "trace-1");
    assertEquals(result, { earlyReturn: true });
    const content = await Deno.readTextFile(filePath);
    assertEquals(content.includes(`status: ${RequestStatus.FAILED}`), true);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[ClarificationGateway.runQualityGate] AUTO_ENRICH recommendation returns the enriched body", async () => {
  const { testDir, filePath } = await makeRequestFile();
  const statusManager = new StatusManager(createMockEventLogger());
  const qualityGate = makeStubGate(RequestQualityRecommendation.AUTO_ENRICH, { enrichedBody: "enriched body text" });
  const gateway = new ClarificationGateway({ statusManager, qualityGate });
  try {
    const result = await gateway.runQualityGate("body", filePath, "req-1", createMockEventLogger(), "trace-1");
    assertEquals(result, { earlyReturn: false, enrichedBody: "enriched body text" });
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[ClarificationGateway.runQualityGate] NEEDS_CLARIFICATION starts a clarification session and returns early", async () => {
  const { testDir, filePath } = await makeRequestFile();
  const statusManager = new StatusManager(createMockEventLogger());
  const qualityGate = makeStubGate(RequestQualityRecommendation.NEEDS_CLARIFICATION);
  const gateway = new ClarificationGateway({ statusManager, qualityGate });
  try {
    const result = await gateway.runQualityGate("body", filePath, "req-1", createMockEventLogger(), "trace-1");
    assertEquals(result, { earlyReturn: true });
    const content = await Deno.readTextFile(filePath);
    assertEquals(content.includes(`status: ${RequestStatus.REFINING}`), true);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("[ClarificationGateway.loadSpecFromClarification] returns the refined body of an agent-satisfied session", async () => {
  const { testDir, filePath } = await makeRequestFile();
  const completedSession: IClarificationSession = {
    requestId: "req-1",
    originalBody: "Do the thing.",
    rounds: [],
    qualityHistory: [],
    status: ClarificationSessionStatus.AGENT_SATISFIED,
    refinedBody: {
      summary: "Do the thing",
      goals: ["Complete the task"],
      successCriteria: ["Task is done"],
      scope: { includes: ["the thing"], excludes: [] },
      constraints: [],
      context: [],
      originalBody: "Do the thing.",
    },
  };
  await saveClarification(filePath, completedSession);
  const statusManager = new StatusManager(createMockEventLogger());
  const gateway = new ClarificationGateway({ statusManager });
  try {
    const result = await gateway.loadSpecFromClarification(filePath);
    assertEquals(result.earlyReturn, false);
    assertEquals(result.specification, completedSession.refinedBody);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});
