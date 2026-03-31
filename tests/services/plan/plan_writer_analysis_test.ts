/**
 * @module PlanWriterAnalysisTest
 * @path tests/services/plan/plan_writer_analysis_test.ts
 * @description Verifies that PlanWriter correctly includes structured request analysis
 * metadata in generated plan files.
 * @related-files [src/services/plan/plan_writer.ts, src/shared/schemas/plan_schema.ts, src/shared/schemas/request/request_analysis.ts]
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import {
  type IAgentExecutionResult,
  type IRequestMetadata,
  PlanWriter,
} from "../../../src/services/plan/plan_writer.ts";
import { ANALYZER_VERSION } from "../../../src/shared/constants.ts";
import { initTestDbService } from "../../helpers/db.ts";
import {
  type IRequestAnalysis,
  RequestAnalysisComplexity,
  RequestTaskType,
} from "../../../src/shared/schemas/request_analysis.ts";
import { AnalysisMode } from "../../../src/shared/types/request.ts";

function createMockAnalysis(): IRequestAnalysis {
  return {
    goals: [{ description: "test goal", explicit: true, priority: 1 }],
    requirements: [{ description: "must pass", confidence: 0.9, type: "functional", explicit: true }],
    constraints: [],
    acceptanceCriteria: ["it works"],
    ambiguities: [],
    actionabilityScore: 85,
    complexity: RequestAnalysisComplexity.SIMPLE,
    taskType: RequestTaskType.BUGFIX,
    tags: ["auth", "security"],
    referencedFiles: ["src/auth.ts"],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 42,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
  };
}

Deno.test("[PlanWriter] includes requestAnalysis in plan metadata", async () => {
  const { db, config, tempDir, cleanup } = await initTestDbService();

  const workspacePath = join(tempDir, config.paths.workspace);
  const plansDir = join(workspacePath, "Plans");
  await Deno.mkdir(plansDir, { recursive: true });

  const writer = new PlanWriter({
    plansDirectory: plansDir,
    includeReasoning: true,
    generateWikiLinks: true,
    runtimeRoot: tempDir,
    db,
  });

  const analysis = createMockAnalysis();
  const metadata: IRequestMetadata = {
    requestId: "req-analysis-test",
    traceId: "trace-123",
    createdAt: new Date(),
    contextFiles: [],
    contextWarnings: [],
    requestAnalysis: analysis,
  };

  const result: IAgentExecutionResult = {
    thought: "Thinking...",
    content: JSON.stringify({
      subject: "Test Subject",
      description: "Test Desc",
      steps: [{ step: 1, title: "Step 1", description: "Do it" }],
    }),
    raw: "raw output",
  };

  try {
    const { planPath } = await writer.writePlan(result, metadata);
    const content = await Deno.readTextFile(planPath);

    // Verify metadata presence in frontmatter
    assertExists(content.includes("request_analysis:"), "Plan should contain request_analysis field");

    // Check if it's valid JSON matched by string
    const analysisJson = JSON.stringify(analysis);
    assertExists(content.includes(analysisJson), "Plan should contain exact analysis JSON");
  } finally {
    await cleanup();
  }
});

Deno.test("[PlanWriter] writes plan without analysis (backward compat)", async () => {
  const { db, config, tempDir, cleanup } = await initTestDbService();

  const workspacePath = join(tempDir, config.paths.workspace);
  const plansDir = join(workspacePath, "Plans");
  await Deno.mkdir(plansDir, { recursive: true });

  const writer = new PlanWriter({
    plansDirectory: plansDir,
    includeReasoning: true,
    generateWikiLinks: true,
    runtimeRoot: tempDir,
    db,
  });

  const metadata: IRequestMetadata = {
    requestId: "req-no-analysis",
    traceId: "trace-456",
    createdAt: new Date(),
    contextFiles: [],
    contextWarnings: [],
  };

  const result: IAgentExecutionResult = {
    thought: "Thinking...",
    content: JSON.stringify({
      subject: "Test Subject",
      description: "Test Desc",
      steps: [{ step: 1, title: "Step 1", description: "Do it" }],
    }),
    raw: "raw output",
  };

  try {
    const { planPath } = await writer.writePlan(result, metadata);
    const content = await Deno.readTextFile(planPath);

    assertEquals(
      content.includes("request_analysis:"),
      false,
      "Plan should NOT contain request_analysis field when absent",
    );
  } finally {
    await cleanup();
  }
});
