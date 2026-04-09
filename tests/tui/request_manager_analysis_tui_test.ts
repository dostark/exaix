/**
 * @module RequestManagerAnalysisTuiTest
 * @path tests/tui/request_manager_analysis_tui_test.ts
 * @description TDD test for Phase 45 Step 13: TUI Analysis Display.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { MinimalRequestServiceMock, RequestManagerTuiSession } from "../../src/tui/request_manager_view.ts";
import { RequestFormatter } from "../../src/tui/request_manager/formatters.ts";
import {
  AmbiguityImpact,
  AnalysisMode,
  type IRequestAnalysis,
  RequestAnalysisComplexity,
  RequestTaskType,
} from "../../src/shared/schemas/request_analysis.ts";
import { RequestPriority, RequestSource } from "../../src/shared/enums.ts";
import { RequestStatus } from "../../src/shared/status/request_status.ts";
import { ANALYZER_VERSION } from "../../src/shared/constants.ts";

Deno.test("RequestManagerTuiSession - Detail View includes Analysis section", async () => {
  const analysis: IRequestAnalysis = {
    complexity: RequestAnalysisComplexity.MEDIUM,
    actionabilityScore: 85,
    taskType: RequestTaskType.FEATURE,
    goals: [
      { description: "Implement TUI check", explicit: true, priority: 1 },
    ],
    requirements: [{ description: "Req 1", confidence: 0.9, type: "functional", explicit: true }],
    ambiguities: [{ description: "Ambiguity 1", impact: AmbiguityImpact.LOW, interpretations: [] }],
    referencedFiles: ["src/main.ts"],
    tags: ["tui"],
    constraints: [],
    acceptanceCriteria: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 100,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
  };

  const mockRequest = {
    trace_id: "test-req-1",
    filename: "test-req-1.md",
    subject: "Test Request",
    status: RequestStatus.PENDING,
    priority: RequestPriority.NORMAL,
    identity: "default",
    created: new Date().toISOString(),
    source: RequestSource.TUI,
    created_by: "test-user",
  };

  const mockService = new MinimalRequestServiceMock([mockRequest]);
  // Mock getAnalysis to return our data
  mockService.getAnalysis = (id: string): Promise<IRequestAnalysis | null> => {
    if (id === "test-req-1") return Promise.resolve(analysis);
    return Promise.resolve(null);
  };
  mockService.getRequestContent = () => Promise.resolve("Request Body Content");

  const session = new RequestManagerTuiSession([mockRequest], mockService, false);

  // Trigger detail view
  await session.showRequestDetail("test-req-1");

  const detail = session.renderDetail();

  // Verify analysis section presence
  assertStringIncludes(detail, "REQUEST ANALYSIS");
  assertStringIncludes(detail, "Complexity:   medium");
  assertStringIncludes(detail, "Actionability: █████████░ 85/100");
  assertStringIncludes(detail, "Goals:        1 total");
  assertStringIncludes(detail, "Implement TUI check");
  assertStringIncludes(detail, "Top Ambiguity: Ambiguity 1");
  assertStringIncludes(detail, "Files:        src/main.ts");
});

Deno.test("RequestFormatter.formatAnalysisSection - formats analysis correctly", () => {
  const analysis: IRequestAnalysis = {
    complexity: RequestAnalysisComplexity.COMPLEX,
    actionabilityScore: 40,
    taskType: RequestTaskType.REFACTOR,
    goals: [
      { description: "Goal 1", explicit: true, priority: 1 },
      { description: "Goal 2", explicit: false, priority: 2 },
    ],
    requirements: [],
    ambiguities: [],
    referencedFiles: [],
    tags: [],
    constraints: [],
    acceptanceCriteria: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 50,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
  };

  const lines = RequestFormatter.formatAnalysisSection(analysis);
  const output = lines.join("\n");

  assertStringIncludes(output, "REQUEST ANALYSIS");
  assertStringIncludes(output, "Complexity:   complex");
  assertStringIncludes(output, "Actionability: ████░░░░░░ 40/100");
  assertStringIncludes(output, "Goals:        2 total");
  assertStringIncludes(output, "[E] Goal 1");
  assertStringIncludes(output, "[I] Goal 2");
});

Deno.test("RequestFormatter.formatAnalysisSection - formats complexity badge with correct color", () => {
  const analysisSimple: IRequestAnalysis = {
    complexity: RequestAnalysisComplexity.SIMPLE,
    actionabilityScore: 100,
    taskType: RequestTaskType.DOCS,
    goals: [],
    requirements: [],
    ambiguities: [],
    referencedFiles: [],
    tags: [],
    constraints: [],
    acceptanceCriteria: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 10,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
  };

  const lines = RequestFormatter.formatAnalysisSection(analysisSimple);
  const output = lines.join("\n");
  assertStringIncludes(output, "Complexity:   simple");

  const analysisEpic: IRequestAnalysis = {
    complexity: RequestAnalysisComplexity.EPIC,
    actionabilityScore: 10,
    taskType: RequestTaskType.FEATURE,
    goals: [],
    requirements: [],
    ambiguities: [],
    referencedFiles: [],
    tags: [],
    constraints: [],
    acceptanceCriteria: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 10,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
  };

  const linesEpic = RequestFormatter.formatAnalysisSection(analysisEpic);
  const outputEpic = linesEpic.join("\n");
  assertStringIncludes(outputEpic, "Complexity:   epic");
});

Deno.test("RequestFormatter.formatAnalysisSection - formats actionability score bar", () => {
  const checkBar = (score: number, expectedBar: string) => {
    const analysis: IRequestAnalysis = {
      complexity: RequestAnalysisComplexity.MEDIUM,
      actionabilityScore: score,
      taskType: RequestTaskType.FEATURE,
      goals: [],
      requirements: [],
      ambiguities: [],
      referencedFiles: [],
      tags: [],
      constraints: [],
      acceptanceCriteria: [],
      metadata: {
        analyzedAt: new Date().toISOString(),
        durationMs: 0,
        mode: AnalysisMode.HEURISTIC,
        analyzerVersion: ANALYZER_VERSION,
      },
    };
    const lines = RequestFormatter.formatAnalysisSection(analysis);
    const output = lines.join("\n");
    assertStringIncludes(output, `Actionability: ${expectedBar} ${score}/100`);
  };

  checkBar(0, "░░░░░░░░░░");
  checkBar(50, "█████░░░░░");
  checkBar(100, "██████████");
});

Deno.test("RequestFormatter.formatAnalysisSection - shows ambiguity summary", () => {
  const analysis: IRequestAnalysis = {
    complexity: RequestAnalysisComplexity.MEDIUM,
    actionabilityScore: 50,
    taskType: RequestTaskType.FEATURE,
    goals: [],
    requirements: [],
    ambiguities: [
      { description: "What is the target platform?", impact: AmbiguityImpact.HIGH, interpretations: [] },
    ],
    referencedFiles: [],
    tags: [],
    constraints: [],
    acceptanceCriteria: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 0,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
  };

  const lines = RequestFormatter.formatAnalysisSection(analysis);
  const output = lines.join("\n");
  assertStringIncludes(output, "Ambiguities: 1");
  assertStringIncludes(output, "Top Ambiguity: What is the target platform?");
});

Deno.test("RequestFormatter.formatAnalysisSection - handles empty analysis", () => {
  const lines = RequestFormatter.formatAnalysisSection(null);
  assertEquals(lines.length, 0);
});
