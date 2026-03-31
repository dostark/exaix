/**
 * @module RequestProcessorComplexityTest
 * @path tests/services/request/request_processor_complexity_test.ts
 * @description Verifies that RequestProcessor's classifyTaskComplexity method
 * uses structured analysis (Phase 45), content heuristics, and agent-ID fallbacks
 * correctly to categorize task complexity.
 * @related-files [src/services/request/request_processor.ts, src/shared/schemas/request_analysis.ts, src/shared/enums.ts]
 */

import { assertEquals } from "@std/assert";
import { RequestProcessor } from "../../../src/services/request/request_processor.ts";
import { ANALYZER_VERSION } from "../../../src/shared/constants.ts";
import { buildParsedRequest } from "../../../src/services/request/request_common.ts";
import { RequestSource, TaskComplexity } from "../../../src/shared/enums.ts";
import { IApplicationContext } from "../../../src/shared/interfaces/i_application_context.ts";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import {
  type IRequestAnalysis,
  RequestAnalysisComplexity,
  RequestTaskType,
} from "../../../src/shared/schemas/request_analysis.ts";
import { AnalysisMode } from "../../../src/shared/types/request.ts";
import { RequestStatus } from "../../../src/shared/status/request_status.ts";
import { initTestDbService } from "../../helpers/db.ts";
import type { IBlueprint, IParsedRequest } from "../../../src/services/agent/agent_runner.ts";
import type { IRequestFrontmatter } from "../../../src/services/request_processing/types.ts";
import {
  COMPLEXITY_BODY_LENGTH_LOW,
  COMPLEXITY_BULLET_THRESHOLD_HIGH,
  COMPLEXITY_FILE_REF_THRESHOLD_HIGH,
} from "../../../src/shared/constants.ts";

/**
 * Create a test RequestProcessor with minimal config
 */
async function createTestProcessor() {
  const { db, config, cleanup } = await initTestDbService();
  const context: IApplicationContext = {
    config: { get: () => config, getChecksum: () => "test" } as any,
    db,
    provider: null as any,
    git: {} as any,
    display: new EventLogger({ db, defaultActor: "test" }),
  };
  const processor = new RequestProcessor({
    workspacePath: "",
    requestsDir: "",
    blueprintsPath: "",
    includeReasoning: false,
    context,
  });
  return { db, config, cleanup, processor };
}

/**
 * Create test blueprint and frontmatter
 */
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

/**
 * Interface representing the private method for testing.
 */
interface IRequestProcessorTest {
  classifyTaskComplexity(
    blueprint: IBlueprint,
    request: IParsedRequest,
    analysis?: IRequestAnalysis,
  ): TaskComplexity;
}

/**
 * Accessor type to avoid prohibited Record types.
 */
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
  // Accessing private method via bracket notation on the instance directly.
  const accessor = (processor as object) as ProcessorAccessor;
  return accessor["classifyTaskComplexity"](blueprint, request, analysis);
}

/**
 * Helper to create a minimal valid IRequestAnalysis for testing.
 */
function createTestAnalysis(complexity: RequestAnalysisComplexity): IRequestAnalysis {
  return {
    goals: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: 100,
    complexity,
    taskType: RequestTaskType.UNKNOWN,
    tags: [],
    referencedFiles: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 0,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
  };
}

/**
 * Creates a RequestProcessor and cleanup function for use in complexity tests.
 */
async function createComplexityTestSetup() {
  const { db, config, cleanup } = await initTestDbService();
  const context: IApplicationContext = {
    config: { get: () => config, getChecksum: () => "test" } as any,
    db,
    provider: null as any,
    git: {} as any,
    display: new EventLogger({ db, defaultActor: "test" }),
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

/**
 * Builds a minimal IParsedRequest for use in complexity tests.
 */
function buildComplexityRequest(body: string, traceId = "t1", reqId = "req-1"): IParsedRequest {
  return buildParsedRequest(
    body,
    {
      trace_id: traceId,
      created: new Date().toISOString(),
      status: RequestStatus.PENDING,
      priority: "normal",
      source: RequestSource.CLI,
      created_by: "user",
    },
    reqId,
    `trace-${reqId}`,
  ) as IParsedRequest;
}

Deno.test("[classifyTaskComplexity] uses analysis complexity as primary signal", async () => {
  const { cleanup, processor } = await createTestProcessor();
  try {
    const { blueprint, frontmatter } = createTestBlueprintAndFrontmatter();
    const request = buildParsedRequest(
      "body",
      frontmatter,
      "req-1",
      "trace-1",
    ) as IParsedRequest;

    // Simple analysis
    const simpleAnalysis = createTestAnalysis(RequestAnalysisComplexity.SIMPLE);
    assertEquals(
      callClassifyTaskComplexity(processor, blueprint, request, simpleAnalysis),
      TaskComplexity.SIMPLE,
    );

    // Complex analysis
    const complexAnalysis = createTestAnalysis(RequestAnalysisComplexity.COMPLEX);
    assertEquals(
      callClassifyTaskComplexity(processor, blueprint, request, complexAnalysis),
      TaskComplexity.COMPLEX,
    );

    // Epic analysis (maps to COMPLEX)
    const epicAnalysis = createTestAnalysis(RequestAnalysisComplexity.EPIC);
    assertEquals(
      callClassifyTaskComplexity(processor, blueprint, request, epicAnalysis),
      TaskComplexity.COMPLEX,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[classifyTaskComplexity] falls back to content heuristics without analysis", async () => {
  const { cleanup, processor } = await createTestProcessor();
  try {
    const { blueprint, frontmatter } = createTestBlueprintAndFrontmatter();

    // Short body -> SIMPLE
    const shortRequest = buildParsedRequest(
      "Fix typo.",
      frontmatter,
      "req-1",
      "trace-1",
    ) as IParsedRequest;
    assertEquals(
      callClassifyTaskComplexity(processor, blueprint, shortRequest),
      TaskComplexity.SIMPLE,
    );

    // Long body with many bullets -> COMPLEX
    const longBody =
      "Implement feature:\n- Requirement 1\n- Requirement 2\n- Requirement 3\n- Requirement 4\n- Requirement 5\n- Requirement 6\n- Requirement 7\n- Requirement 8\n- Requirement 9\n- Requirement 10\n- Requirement 11";
    const longRequest = buildParsedRequest(
      longBody,
      { ...frontmatter, trace_id: "t2" },
      "req-2",
      "trace-2",
    ) as IParsedRequest;
    assertEquals(
      callClassifyTaskComplexity(processor, blueprint, longRequest),
      TaskComplexity.COMPLEX,
    );

    // Body with many file refs -> COMPLEX
    const fileRefBody = "Update src/a.ts, src/b.ts, src/c.ts, src/d.ts, src/e.ts, src/f.ts";
    const fileRefRequest = buildParsedRequest(
      fileRefBody,
      { ...frontmatter, trace_id: "t3" },
      "req-3",
      "trace-3",
    ) as IParsedRequest;
    assertEquals(
      callClassifyTaskComplexity(processor, blueprint, fileRefRequest),
      TaskComplexity.COMPLEX,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[classifyTaskComplexity] falls back to agent ID without analysis or content signal", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const processor = new RequestProcessor({
      workspacePath: "",
      requestsDir: "",
      blueprintsPath: "",
      includeReasoning: false,
      context: {
        config: { get: () => config, getChecksum: () => "test" } as any,
        db,
        provider: null as any,
        git: {} as any,
        display: new EventLogger({ db, defaultActor: "test" }),
      },
    });

    const frontmatter: IRequestFrontmatter = {
      trace_id: "t1",
      created: new Date().toISOString(),
      status: RequestStatus.PENDING,
      priority: "normal",
      source: RequestSource.CLI,
      created_by: "user",
    };

    const request = buildParsedRequest(
      "Standard request body of medium length that doesn't trigger heuristics.",
      frontmatter,
      "req-1",
      "trace-1",
    ) as IParsedRequest;

    const baseBlueprint: IBlueprint = {
      systemPrompt: "test",
    };

    // Coder agent -> COMPLEX
    assertEquals(
      callClassifyTaskComplexity(
        processor,
        { ...baseBlueprint, identityId: "expert-coder" },
        request,
      ),
      TaskComplexity.COMPLEX,
    );

    // Analyzer agent -> SIMPLE
    assertEquals(
      callClassifyTaskComplexity(
        processor,
        { ...baseBlueprint, identityId: "log-analyzer" },
        request,
      ),
      TaskComplexity.SIMPLE,
    );

    // Generic agent -> MEDIUM
    assertEquals(
      callClassifyTaskComplexity(
        processor,
        { ...baseBlueprint, identityId: "helper" },
        request,
      ),
      TaskComplexity.MEDIUM,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[classifyTaskComplexity] content heuristic: short body with no bullets -> SIMPLE", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  try {
    const blueprint: IBlueprint = { identityId: "helper", systemPrompt: "test" };
    assertEquals(
      callClassifyTaskComplexity(processor, blueprint, buildComplexityRequest("Just fix spelling.")),
      TaskComplexity.SIMPLE,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[classifyTaskComplexity] content heuristic: many bullets (>=8) -> COMPLEX", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  try {
    const blueprint: IBlueprint = { identityId: "helper", systemPrompt: "test" };
    const longBody = "Requirements:\n- R1\n- R2\n- R3\n- R4\n- R5\n- R6\n- R7\n- R8";
    assertEquals(
      callClassifyTaskComplexity(processor, blueprint, buildComplexityRequest(longBody)),
      TaskComplexity.COMPLEX,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[classifyTaskComplexity] content heuristic: many file refs (>=5) -> COMPLEX", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  try {
    const blueprint: IBlueprint = { identityId: "helper", systemPrompt: "test" };
    assertEquals(
      callClassifyTaskComplexity(processor, blueprint, buildComplexityRequest("Change a.ts, b.ts, c.ts, d.ts, e.ts")),
      TaskComplexity.COMPLEX,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[classifyTaskComplexity] handles empty/undefined body gracefully (MEDIUM via agent ID)", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  try {
    const blueprint: IBlueprint = { identityId: "helper", systemPrompt: "test" };
    assertEquals(
      callClassifyTaskComplexity(processor, blueprint, buildComplexityRequest("")),
      TaskComplexity.MEDIUM,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[classifyTaskComplexity] maps EPIC to COMPLEX", async () => {
  const { processor, cleanup } = await createComplexityTestSetup();
  try {
    const blueprint: IBlueprint = { identityId: "helper", systemPrompt: "test" };
    const analysis = createTestAnalysis(RequestAnalysisComplexity.EPIC);
    assertEquals(
      callClassifyTaskComplexity(processor, blueprint, buildComplexityRequest("body"), analysis),
      TaskComplexity.COMPLEX,
    );
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Phase 49 Step 7 — threshold boundary tests using Step 12 constants
// ---------------------------------------------------------------------------

Deno.test(
  "[classifyTaskComplexity] file refs at threshold (COMPLEXITY_FILE_REF_THRESHOLD_HIGH) -> COMPLEX",
  async () => {
    const { processor, cleanup } = await createComplexityTestSetup();
    try {
      const blueprint: IBlueprint = { identityId: "helper", systemPrompt: "test" };
      // Build body with exactly COMPLEXITY_FILE_REF_THRESHOLD_HIGH file references.
      const refs = Array.from(
        { length: COMPLEXITY_FILE_REF_THRESHOLD_HIGH },
        (_, i) => `ref${i}.ts`,
      ).join(", ");
      assertEquals(
        callClassifyTaskComplexity(processor, blueprint, buildComplexityRequest(refs)),
        TaskComplexity.COMPLEX,
      );
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "[classifyTaskComplexity] file refs below threshold (COMPLEXITY_FILE_REF_THRESHOLD_HIGH - 1) -> no file-ref signal",
  async () => {
    const { processor, cleanup } = await createComplexityTestSetup();
    try {
      const blueprint: IBlueprint = { identityId: "helper", systemPrompt: "test" };
      // Build a body with one fewer file reference than the threshold — no COMPLEX from this signal.
      const refs = Array.from(
        { length: COMPLEXITY_FILE_REF_THRESHOLD_HIGH - 1 },
        (_, i) => `ref${i}.ts`,
      ).join(", ");
      // Pad with non-whitespace chars to exceed COMPLEXITY_BODY_LENGTH_LOW so the short-body SIMPLE rule doesn't fire.
      const padding = "a".repeat(Math.max(0, COMPLEXITY_BODY_LENGTH_LOW - refs.length + 1));
      const body = `${refs} ${padding}`;
      // Body has few refs, no bullets, and is not short — falls to MEDIUM via agent ID.
      assertEquals(
        callClassifyTaskComplexity(processor, blueprint, buildComplexityRequest(body)),
        TaskComplexity.MEDIUM,
      );
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "[classifyTaskComplexity] bullets at threshold (COMPLEXITY_BULLET_THRESHOLD_HIGH) -> COMPLEX",
  async () => {
    const { processor, cleanup } = await createComplexityTestSetup();
    try {
      const blueprint: IBlueprint = { identityId: "helper", systemPrompt: "test" };
      const body = "Header:\n" +
        Array.from({ length: COMPLEXITY_BULLET_THRESHOLD_HIGH }, (_, i) => `- item ${i}`).join("\n");
      assertEquals(
        callClassifyTaskComplexity(processor, blueprint, buildComplexityRequest(body)),
        TaskComplexity.COMPLEX,
      );
    } finally {
      await cleanup();
    }
  },
);

Deno.test(
  "[classifyTaskComplexity] body below COMPLEXITY_BODY_LENGTH_LOW with no bullets -> SIMPLE",
  async () => {
    const { processor, cleanup } = await createComplexityTestSetup();
    try {
      const blueprint: IBlueprint = { identityId: "helper", systemPrompt: "test" };
      // Construct a body just under COMPLEXITY_BODY_LENGTH_LOW characters.
      const shortBody = "x".repeat(COMPLEXITY_BODY_LENGTH_LOW - 1);
      assertEquals(
        callClassifyTaskComplexity(processor, blueprint, buildComplexityRequest(shortBody)),
        TaskComplexity.SIMPLE,
      );
    } finally {
      await cleanup();
    }
  },
);
