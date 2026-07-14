/**
 * @module TaskComplexityClassifierTest
 * @path packages/request/tests/task_complexity_classifier_test.ts
 * @architectural-layer Services
 * @description Verifies TaskComplexityClassifier categorizes task complexity via
 * structured analysis (Phase 45), content heuristics, and agent-ID fallbacks.
 * Direct unit coverage for the extracted classifier (god-object decomposition
 * of RequestProcessor); packages/request/tests/request_processor_complexity_test.ts
 * covers the RequestProcessor delegation path.
 * @related-files [packages/request/src/task_complexity_classifier.ts, "packages/schemas/src/request_analysis.ts", "packages/core/src/types/enums.ts"]
 */

import { assertEquals } from "@std/assert";
import { TaskComplexityClassifier } from "@exaix/request";
import { TaskComplexity } from "@exaix/core";
import {
  COMPLEXITY_BODY_LENGTH_LOW,
  COMPLEXITY_BULLET_THRESHOLD_HIGH,
  COMPLEXITY_FILE_REF_THRESHOLD_HIGH,
} from "@exaix/core";
import { type IRequestAnalysis, RequestAnalysisComplexity } from "@exaix/schemas/request_analysis.ts";
import type { IBlueprint, IParsedRequest } from "@exaix/execution";
import { makeAnalysis } from "./request_test_helpers.ts";

function makeRequest(userPrompt: string): IParsedRequest {
  return { userPrompt, context: {} };
}

function makeBlueprint(identityId?: string): IBlueprint {
  return { identityId, systemPrompt: "test" };
}

Deno.test("[TaskComplexityClassifier.classify] structured analysis: maps SIMPLE correctly", () => {
  const classifier = new TaskComplexityClassifier();
  const analysis: IRequestAnalysis = makeAnalysis({ complexity: RequestAnalysisComplexity.SIMPLE });
  const result = classifier.classify(makeBlueprint("generic-agent"), makeRequest("test"), analysis);
  assertEquals(result, TaskComplexity.SIMPLE);
});

Deno.test("[TaskComplexityClassifier.classify] structured analysis: maps MEDIUM correctly", () => {
  const classifier = new TaskComplexityClassifier();
  const analysis: IRequestAnalysis = makeAnalysis({ complexity: RequestAnalysisComplexity.MEDIUM });
  const result = classifier.classify(makeBlueprint("generic-agent"), makeRequest("test"), analysis);
  assertEquals(result, TaskComplexity.MEDIUM);
});

Deno.test("[TaskComplexityClassifier.classify] structured analysis: maps COMPLEX correctly", () => {
  const classifier = new TaskComplexityClassifier();
  const analysis: IRequestAnalysis = makeAnalysis({ complexity: RequestAnalysisComplexity.COMPLEX });
  const result = classifier.classify(makeBlueprint("generic-agent"), makeRequest("test"), analysis);
  assertEquals(result, TaskComplexity.COMPLEX);
});

Deno.test("[TaskComplexityClassifier.classify] structured analysis: maps EPIC to COMPLEX correctly", () => {
  const classifier = new TaskComplexityClassifier();
  const analysis: IRequestAnalysis = makeAnalysis({ complexity: RequestAnalysisComplexity.EPIC });
  const result = classifier.classify(makeBlueprint("generic-agent"), makeRequest("test"), analysis);
  assertEquals(result, TaskComplexity.COMPLEX);
});

Deno.test("[TaskComplexityClassifier.classify] heuristics: detects COMPLEX via high bullet point count", () => {
  const classifier = new TaskComplexityClassifier();
  const manyBullets = Array.from({ length: COMPLEXITY_BULLET_THRESHOLD_HIGH + 1 }, (_, i) => `- Task ${i}`).join(
    "\n",
  );
  const result = classifier.classify(makeBlueprint("generic-agent"), makeRequest(manyBullets));
  assertEquals(result, TaskComplexity.COMPLEX);
});

Deno.test("[TaskComplexityClassifier.classify] heuristics: detects COMPLEX via high file reference count", () => {
  const classifier = new TaskComplexityClassifier();
  const manyRefs = Array.from(
    { length: COMPLEXITY_FILE_REF_THRESHOLD_HIGH + 1 },
    (_, i) => `Check file src/file${i}.ts`,
  ).join("\n");
  const result = classifier.classify(makeBlueprint("generic-agent"), makeRequest(manyRefs));
  assertEquals(result, TaskComplexity.COMPLEX);
});

Deno.test("[TaskComplexityClassifier.classify] heuristics: detects SIMPLE via short body without newlines", () => {
  const classifier = new TaskComplexityClassifier();
  const shortBody = "Just fix it".repeat(COMPLEXITY_BODY_LENGTH_LOW / 20);
  const result = classifier.classify(makeBlueprint("generic-agent"), makeRequest(shortBody));
  assertEquals(result, TaskComplexity.SIMPLE);
});

Deno.test("[TaskComplexityClassifier.classify] agent fallbacks: 'analyzer' ID maps to SIMPLE", () => {
  const classifier = new TaskComplexityClassifier();
  const result = classifier.classify(
    makeBlueprint("request-analyzer"),
    makeRequest("I want to analyze something"),
  );
  assertEquals(result, TaskComplexity.SIMPLE);
});

Deno.test("[TaskComplexityClassifier.classify] agent fallbacks: 'summarizer' ID maps to SIMPLE", () => {
  const classifier = new TaskComplexityClassifier();
  const result = classifier.classify(
    makeBlueprint("content-summarizer"),
    makeRequest("Summarize this text"),
  );
  assertEquals(result, TaskComplexity.SIMPLE);
});

Deno.test("[TaskComplexityClassifier.classify] agent fallbacks: 'coder' ID maps to COMPLEX", () => {
  const classifier = new TaskComplexityClassifier();
  const result = classifier.classify(
    makeBlueprint("advanced-coder"),
    makeRequest(
      "I need you to write some sophisticated code for the authentication module and handle edge cases",
    ),
  );
  assertEquals(result, TaskComplexity.COMPLEX);
});

Deno.test("[TaskComplexityClassifier.classify] agent fallbacks: 'planner' ID maps to COMPLEX", () => {
  const classifier = new TaskComplexityClassifier();
  const result = classifier.classify(
    makeBlueprint("strategy-planner"),
    makeRequest("Plan a multi-step migration process for the entire system following architectural guidelines"),
  );
  assertEquals(result, TaskComplexity.COMPLEX);
});

Deno.test("[TaskComplexityClassifier.classify] agent fallbacks: 'architect' ID maps to COMPLEX", () => {
  const classifier = new TaskComplexityClassifier();
  const result = classifier.classify(
    makeBlueprint("cloud-architect"),
    makeRequest("I want to architect a highly scalable microservices system using modern patterns"),
  );
  assertEquals(result, TaskComplexity.COMPLEX);
});

Deno.test("[TaskComplexityClassifier.classify] agent fallbacks: any agent maps to MEDIUM", () => {
  const classifier = new TaskComplexityClassifier();
  const result = classifier.classify(
    makeBlueprint("mysterious-agent"),
    makeRequest("Perform some generic task that doesn't fit into any specific category"),
  );
  assertEquals(result, TaskComplexity.MEDIUM);
});
