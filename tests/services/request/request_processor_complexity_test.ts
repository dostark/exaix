/**
 * @module RequestProcessorComplexityTest
 * @path tests/services/request/request_processor_complexity_test.ts
 * @description Verifies that RequestProcessor's classifyTaskComplexity method
 * uses structured analysis (Phase 45), content heuristics, and agent-ID fallbacks
 * correctly to categorize task complexity.
 * @related-files [src/services/request/request_processor.ts, "packages/schemas/src/request_analysis.ts", "packages/core/src/types/enums.ts"]
 */

import { assertEquals } from "@std/assert";
import { RequestProcessor } from "../../../src/services/request/request_processor.ts";
import type { ANALYZER_VERSION as _ANALYZER_VERSION } from "@exaix/core";
import { buildParsedRequest } from "../../../src/services/request/request_common.ts";
import { RequestSource, RequestStatus, TaskComplexity } from "@exaix/core";
import type { IApplicationContext } from "@exaix/core/types";
import { type IRequestAnalysis, RequestAnalysisComplexity } from "@exaix/schemas/request_analysis.ts";
import { initTestDbService } from "../../helpers/db.ts";
import type { IBlueprint, IParsedRequest } from "../../../src/services/agent/agent_runner.ts";
import type { IRequestFrontmatter } from "@exaix/core/request/mod.ts";
import {
  COMPLEXITY_BODY_LENGTH_LOW,
  COMPLEXITY_BULLET_THRESHOLD_HIGH,
  COMPLEXITY_FILE_REF_THRESHOLD_HIGH,
} from "@exaix/core";
import { makeAnalysis } from "./request_test_helpers.ts";
import { createStubConfig, createStubDisplay, createStubGit, createStubProvider } from "../../helpers/test_helpers.ts";

/**
 * Accessor type to avoid prohibited Record types.
 */
interface IRequestProcessorTest {
  classifyTaskComplexity(
    blueprint: IBlueprint,
    request: IParsedRequest,
    analysis?: IRequestAnalysis,
  ): TaskComplexity;
}
type ProcessorAccessor = { [K in keyof IRequestProcessorTest]: IRequestProcessorTest[K] };

/**
 * Helper to call the private classifyTaskComplexity method without forbidden casts.
 */
function callClassifyTaskComplexity(
  processor: RequestProcessor,
  blueprint: IBlueprint,
  request: IParsedRequest,
  analysis?: IRequestAnalysis,
): TaskComplexity {
  const accessor = (processor as object) as ProcessorAccessor;
  return accessor["classifyTaskComplexity"](blueprint, request, analysis);
}

/**
 * Creates a RequestProcessor and cleanup function for use in complexity tests.
 */
async function createComplexityTestSetup() {
  const { db, config, cleanup } = await initTestDbService();
  const context: IApplicationContext = {
    config: createStubConfig(config),
    db,
    provider: createStubProvider(),
    git: createStubGit(),
    display: createStubDisplay(db),
  };
  const processor = new RequestProcessor({
    workspacePath: "",
    requestsDir: "",
    blueprintsPath: "",
    includeReasoning: false,
    context,
  });
  return { processor, cleanup };
}

function createTestBlueprintAndFrontmatter(): { blueprint: IBlueprint; frontmatter: IRequestFrontmatter } {
  return {
    blueprint: {
      identityId: "generic-agent",
      systemPrompt: "test",
    },
    frontmatter: {
      trace_id: "t1",
      created: new Date().toISOString(),
      status: RequestStatus.PENDING,
      priority: "normal",
      source: RequestSource.CLI,
      created_by: "user",
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("[RequestProcessor.classifyTaskComplexity] structured analysis: maps SIMPLE correctly", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { blueprint, frontmatter } = createTestBlueprintAndFrontmatter();
  const request = buildParsedRequest("test", frontmatter, "r1", "t1");
  const analysis = makeAnalysis({ complexity: RequestAnalysisComplexity.SIMPLE });

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request, analysis);
    assertEquals(result, TaskComplexity.SIMPLE);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor.classifyTaskComplexity] structured analysis: maps MEDIUM correctly", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { blueprint, frontmatter } = createTestBlueprintAndFrontmatter();
  const request = buildParsedRequest("test", frontmatter, "r1", "t1");
  const analysis = makeAnalysis({ complexity: RequestAnalysisComplexity.MEDIUM });

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request, analysis);
    assertEquals(result, TaskComplexity.MEDIUM);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor.classifyTaskComplexity] structured analysis: maps COMPLEX correctly", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { blueprint, frontmatter } = createTestBlueprintAndFrontmatter();
  const request = buildParsedRequest("test", frontmatter, "r1", "t1");
  const analysis = makeAnalysis({ complexity: RequestAnalysisComplexity.COMPLEX });

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request, analysis);
    assertEquals(result, TaskComplexity.COMPLEX);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor.classifyTaskComplexity] structured analysis: maps EPIC to COMPLEX correctly", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { blueprint, frontmatter } = createTestBlueprintAndFrontmatter();
  const request = buildParsedRequest("test", frontmatter, "r1", "t1");
  const analysis = makeAnalysis({ complexity: RequestAnalysisComplexity.EPIC });

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request, analysis);
    assertEquals(result, TaskComplexity.COMPLEX);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor.classifyTaskComplexity] heuristics: detects COMPLEX via high bullet point count", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { blueprint, frontmatter } = createTestBlueprintAndFrontmatter();
  const manyBullets = Array.from({ length: COMPLEXITY_BULLET_THRESHOLD_HIGH + 1 }, (_, i) => `- Task ${i}`).join("\n");
  const request = buildParsedRequest(manyBullets, frontmatter, "r1", "t1");

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request);
    assertEquals(result, TaskComplexity.COMPLEX);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor.classifyTaskComplexity] heuristics: detects COMPLEX via high file reference count", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { blueprint, frontmatter } = createTestBlueprintAndFrontmatter();
  const manyRefs = Array.from(
    { length: COMPLEXITY_FILE_REF_THRESHOLD_HIGH + 1 },
    (_, i) => `Check file src/file${i}.ts`,
  ).join("\n");
  const request = buildParsedRequest(manyRefs, frontmatter, "r1", "t1");

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request);
    assertEquals(result, TaskComplexity.COMPLEX);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor.classifyTaskComplexity] heuristics: detects SIMPLE via short body without newlines", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { blueprint, frontmatter } = createTestBlueprintAndFrontmatter();
  const shortBody = "Just fix it".repeat(COMPLEXITY_BODY_LENGTH_LOW / 20); // Still short enough
  const request = buildParsedRequest(shortBody, frontmatter, "r1", "t1");

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request);
    assertEquals(result, TaskComplexity.SIMPLE);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor.classifyTaskComplexity] agent fallbacks: 'analyzer' ID maps to SIMPLE", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { frontmatter } = createTestBlueprintAndFrontmatter();
  const request = buildParsedRequest("I want to analyze something", frontmatter, "r1", "t1");
  const blueprint: IBlueprint = { identityId: "request-analyzer", systemPrompt: "test" };

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request);
    assertEquals(result, TaskComplexity.SIMPLE);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor.classifyTaskComplexity] agent fallbacks: 'summarizer' ID maps to SIMPLE", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { frontmatter } = createTestBlueprintAndFrontmatter();
  const request = buildParsedRequest("Summarize this text", frontmatter, "r1", "t1");
  const blueprint: IBlueprint = { identityId: "content-summarizer", systemPrompt: "test" };

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request);
    assertEquals(result, TaskComplexity.SIMPLE);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor.classifyTaskComplexity] agent fallbacks: 'coder' ID maps to COMPLEX", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { frontmatter } = createTestBlueprintAndFrontmatter();
  const request = buildParsedRequest(
    "I need you to write some sophisticated code for the authentication module and handle edge cases",
    frontmatter,
    "r1",
    "t1",
  );
  const blueprint: IBlueprint = { identityId: "advanced-coder", systemPrompt: "test" };

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request);
    assertEquals(result, TaskComplexity.COMPLEX);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor.classifyTaskComplexity] agent fallbacks: 'planner' ID maps to COMPLEX", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { frontmatter } = createTestBlueprintAndFrontmatter();
  const request = buildParsedRequest(
    "Plan a multi-step migration process for the entire system following architectural guidelines",
    frontmatter,
    "r1",
    "t1",
  );
  const blueprint: IBlueprint = { identityId: "strategy-planner", systemPrompt: "test" };

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request);
    assertEquals(result, TaskComplexity.COMPLEX);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor.classifyTaskComplexity] agent fallbacks: 'architect' ID maps to COMPLEX", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { frontmatter } = createTestBlueprintAndFrontmatter();
  const request = buildParsedRequest(
    "I want to architect a highly scalable microservices system using modern patterns",
    frontmatter,
    "r1",
    "t1",
  );
  const blueprint: IBlueprint = { identityId: "cloud-architect", systemPrompt: "test" };

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request);
    assertEquals(result, TaskComplexity.COMPLEX);
  } finally {
    await cleanup();
  }
});

Deno.test("[RequestProcessor.classifyTaskComplexity] agent fallbacks: any agent map to MEDIUM", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  const { frontmatter } = createTestBlueprintAndFrontmatter();
  const request = buildParsedRequest(
    "Perform some generic task that doesn't fit into any specific category",
    frontmatter,
    "r1",
    "t1",
  );
  const blueprint: IBlueprint = { identityId: "mysterious-agent", systemPrompt: "test" };

  try {
    const result = callClassifyTaskComplexity(processor, blueprint, request);
    assertEquals(result, TaskComplexity.MEDIUM);
  } finally {
    await cleanup();
  }
});
