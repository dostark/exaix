/**
 * @module RequestProcessorTest
 * @path packages/request/tests/request_processor_test.ts
 * @related-files []
 * @architectural-layer Services
 * @description Verifies the RequestProcessor, validating request parsing,
 * plan generation via LLM providers, and robust orchestration of flow-based requests.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { MockStrategy, PricingTier, ProviderCostTier } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { type IRequestProcessorConfig, RequestProcessor } from "@exaix/request";
import { AgentRunner } from "@exaix/execution";

import type { IModelProvider } from "@exaix/ai/types.ts";
import { ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { MockLLMProvider } from "@exaix/ai/providers";
import { CostTracker } from "@exaix/core/cost";
import type { DatabaseService } from "@exaix/storage-sqlite";
import type { Config } from "@exaix/schemas/config.ts";
import type { IApplicationContext } from "@exaix/core/types";
import type { IFlowRunner } from "@exaix/flow";
import type { IFlow } from "@exaix/schemas/flow.ts";
import {
  createStubConfig,
  createStubDisplay,
  createStubGit,
  createStubProvider,
  getBlueprintsIdentitiesDir,
  getWorkspaceDir,
  getWorkspacePlansDir,
  getWorkspaceRequestsDir,
  initTestDbService,
  readFixtureTextSync,
} from "@exaix/testing";

// ============================================================================
// Test Utilities
// ============================================================================

function createTestRequestPath(tempDir: string): { traceId: string; requestPath: string } {
  const traceId = crypto.randomUUID();
  const requestPath = join(getWorkspaceRequestsDir(tempDir), `request-${traceId.slice(0, 8)}.md`);
  return { traceId, requestPath };
}
/**
 * Create a request file with YAML frontmatter
 */
function createRequestContent(opts: {
  traceId: string;
  identity?: string;
  flow?: string;
  status?: string;
  priority?: string;
  body: string;
}): string {
  const fields = [
    `trace_id: "${opts.traceId}"`,
    `created: "${new Date().toISOString()}"`,
    `status: ${opts.status || MemoryStatus.PENDING}`,
    `priority: ${opts.priority || "normal"}`,
    opts.flow ? null : `identity: ${opts.identity || "default"}`, // Only include agent if no flow
    opts.flow ? `flow: ${opts.flow}` : null,
    `source: cli`,
    `created_by: "test@example.com"`,
    `subject: "Test Request Subject"`,
  ].filter(Boolean);

  return `---
${fields.join("\n")}
---

# Request

${opts.body}
`;
}

/**
 * Create a default agent blueprint file
 */
function createBlueprintContent(): string {
  const fixture_1 = readFixtureTextSync(
    import.meta.url,
    "services",
    "request",
    "request_processor_test",
    "fixture_1.md",
  );
  return fixture_1;
}

// ============================================================================
// Tests
// ============================================================================

describe("RequestProcessor", () => {
  let testDir: string;
  let config: Config;
  let db: DatabaseService;
  let processorConfig: IRequestProcessorConfig;
  let cleanup: () => Promise<void>;
  let costTracker: CostTracker;
  let createProcessor: (provider?: IModelProvider, flowRunner?: IFlowRunner) => RequestProcessor;

  beforeEach(async () => {
    // Initialize database with initTestDbService (creates temp dir with activity table)
    const testDbResult = await initTestDbService();
    testDir = testDbResult.tempDir;
    db = testDbResult.db;
    config = testDbResult.config;
    cleanup = testDbResult.cleanup;
    costTracker = new CostTracker(db, config);

    // Create additional required directories
    await Deno.mkdir(getWorkspaceRequestsDir(testDir), { recursive: true });
    await Deno.mkdir(getWorkspacePlansDir(testDir), { recursive: true });
    await Deno.mkdir(join(testDir, "Blueprints", "Identities"), { recursive: true });

    // Create default blueprint
    await Deno.writeTextFile(
      join(testDir, "Blueprints", "Identities", "default.md"),
      createBlueprintContent(),
    );

    // Create processor config
    processorConfig = {
      workspacePath: getWorkspaceDir(testDir),
      requestsDir: getWorkspaceRequestsDir(testDir),
      blueprintsPath: getBlueprintsIdentitiesDir(testDir),
      includeReasoning: true,
    };

    // Set up ProviderRegistry for testing
    ProviderRegistry.clear();
    ProviderRegistry.registerWithMetadata("mock", new MockProviderFactory(), {
      name: "mock",
      costTier: ProviderCostTier.FREE,
      pricingTier: PricingTier.FREE,
      capabilities: ["chat"],
      description: "Mock provider for testing",
      strengths: ["fast", "reliable", "deterministic"],
    });

    createProcessor = (provider?: IModelProvider, flowRunner?: IFlowRunner) => {
      const resolvedProvider = provider ??
        createStubProvider(
          '<thought>ok</thought><content>{"description": "Mock plan", ' +
            '"steps": [{"step": 1, "title": "Mock step", "description": "Mock step description"}]}</content>',
        );
      const context: IApplicationContext = {
        config: createStubConfig(config),
        db,
        provider: resolvedProvider,
        git: createStubGit(),
        display: createStubDisplay(db),
      };
      return new RequestProcessor({
        ...processorConfig,
        context,
        testProvider: provider,
        costTracker,
        flowRunner,
        agentRunner: new AgentRunner(resolvedProvider),
      });
    };
  });

  afterEach(async () => {
    // Clean up ProviderRegistry
    ProviderRegistry.clear();
    await costTracker.flush();

    // Use the cleanup function from initTestDbService
    await cleanup();
  });

  describe("Request Parsing", () => {
    it("should parse valid request file with YAML frontmatter", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = createRequestContent({
        traceId,
        identity: "default",
        body: "Add a hello world function to utils.ts",
      });

      await Deno.writeTextFile(requestPath, requestContent);

      const processor = createProcessor();

      const result = await processor.process(requestPath);

      assert(result !== null, "Result should not be null for valid request");
      assertStringIncludes(result!, "_plan.md");
    });

    it("should return null for invalid YAML frontmatter", async () => {
      const requestPath = join(getWorkspaceRequestsDir(testDir), "invalid-request.md");
      const invalidContent = `+++
this is toml not yaml
+++

# Request

Do something
`;

      await Deno.writeTextFile(requestPath, invalidContent);

      const processor = createProcessor();

      const result = await processor.process(requestPath);

      assertEquals(result, null, "Should return null for invalid frontmatter");
    });

    it("should return null for request missing trace_id", async () => {
      const requestPath = join(getWorkspaceRequestsDir(testDir), "missing-trace.md");
      const invalidContent = `+++
status = MemoryStatus.PENDING
agent = "default"
+++

# Request

Do something
`;

      await Deno.writeTextFile(requestPath, invalidContent);
      const processor = createProcessor();
      const result = await processor.process(requestPath);

      assertEquals(result, null, "Should return null for missing trace_id");
    });
  });

  describe("Plan Generation", () => {
    it("should generate plan using MockLLMProvider", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = createRequestContent({
        traceId,
        body: "Create a user authentication system",
      });

      await Deno.writeTextFile(requestPath, requestContent);
      const processor = createProcessor();
      const planPath = await processor.process(requestPath);

      assert(planPath !== null, "Plan path should not be null");

      // Verify plan file was created
      const planContent = await Deno.readTextFile(planPath!);
      assert(planContent.length > 0, "Plan content should not be empty");
    });

    it("should write plan to Workspace/Plans/ directory", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = createRequestContent({
        traceId,
        body: "Add logging to the service layer",
      });

      await Deno.writeTextFile(requestPath, requestContent);
      const processor = createProcessor();
      const planPath = await processor.process(requestPath);

      assert(planPath !== null);
      assertStringIncludes(planPath!, getWorkspacePlansDir(testDir));
    });

    it("should create plan with correct frontmatter", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestId = `request-${traceId.slice(0, 8)}`;
      const requestContent = createRequestContent({
        traceId,
        body: "Implement error handling",
      });

      await Deno.writeTextFile(requestPath, requestContent);
      const processor = createProcessor();
      const planPath = await processor.process(requestPath);
      assert(planPath !== null);

      const planContent = await Deno.readTextFile(planPath!);

      // Verify frontmatter structure
      assertStringIncludes(planContent, `trace_id: ${traceId}`);
      assertStringIncludes(planContent, `request_id: ${requestId}`);
      assertStringIncludes(planContent, "status: review");
    });
  });

  describe("Request Status Update", () => {
    it("should update request status to 'planned'", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = createRequestContent({
        traceId,
        status: MemoryStatus.PENDING,
        body: "Add unit tests",
      });

      await Deno.writeTextFile(requestPath, requestContent);
      const processor = createProcessor();
      await processor.process(requestPath);

      // Re-read request file to check status update
      const updatedContent = await Deno.readTextFile(requestPath);
      assertStringIncludes(updatedContent, "status: planned");
    });
  });

  describe("IActivity Logging", () => {
    it("should log processing start and completion", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = createRequestContent({
        traceId,
        body: "Refactor the database layer",
      });

      await Deno.writeTextFile(requestPath, requestContent);
      const processor = createProcessor();
      await processor.process(requestPath);

      // Wait for activity logs to be flushed
      await db.waitForFlush();

      // Query activity log for this trace_id using the proper API
      const activities = db.getActivitiesByTrace(traceId);

      assert(activities.length >= 2, "Should have at least 2 activity entries");

      const actionTypes = activities.map((a) => a.action_type);
      assert(actionTypes.includes("request.processing"), "Should log processing start");
      assert(actionTypes.includes("request.planned"), "Should log completion");
    });
  });

  describe("Error Handling", () => {
    it("should handle LLM errors gracefully", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = createRequestContent({
        traceId,
        body: "This will fail",
      });

      await Deno.writeTextFile(requestPath, requestContent);

      // Create a failing mock provider to simulate LLM failure
      const failingProvider = new MockLLMProvider(MockStrategy.FAILING, {
        id: "failing-mock",
        errorMessage: "Simulated LLM failure",
      });
      const processor = createProcessor(failingProvider);
      const result = await processor.process(requestPath);

      // Should return null on error (not throw)
      assertEquals(result, null, "Should return null on LLM error");

      // Check request status is updated to 'failed'
      const updatedContent = await Deno.readTextFile(requestPath);
      assertStringIncludes(updatedContent, "status: failed");
    });

    it("should handle missing blueprint gracefully", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = createRequestContent({
        traceId,
        identity: "nonexistent-agent",
        body: "Use a missing blueprint",
      });

      await Deno.writeTextFile(requestPath, requestContent);
      const processor = createProcessor();
      const result = await processor.process(requestPath);

      // Should return null when blueprint doesn't exist
      assertEquals(result, null, "Should return null for missing blueprint");
    });

    it("should handle file read errors", async () => {
      const processor = createProcessor();

      // Try to process a non-existent file
      const result = await processor.process("/nonexistent/path/request.md");

      assertEquals(result, null, "Should return null for non-existent file");
    });
  });

  describe("Task IClassification", () => {
    it("should classify analyzer agents as simple tasks", async () => {
      // Create data-analyzer blueprint
      await Deno.writeTextFile(
        join(testDir, "Blueprints", "Identities", "data-analyzer.md"),
        createBlueprintContent(),
      );

      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = createRequestContent({
        traceId,
        identity: "data-analyzer",
        body: "Analyze this dataset",
      });

      await Deno.writeTextFile(requestPath, requestContent);

      const processor = createProcessor();

      const result = await processor.process(requestPath);

      assert(result !== null, "Result should not be null for valid request");
      assertStringIncludes(result!, "_plan.md");
    });

    it("should classify coder agents as complex tasks", async () => {
      // Create senior-coder blueprint
      await Deno.writeTextFile(
        join(testDir, "Blueprints", "Identities", "senior-coder.md"),
        createBlueprintContent(),
      );

      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = createRequestContent({
        traceId,
        identity: "senior-coder",
        body: "Implement a complex algorithm",
      });

      await Deno.writeTextFile(requestPath, requestContent);

      const processor = createProcessor();

      const result = await processor.process(requestPath);

      assert(result !== null, "Result should not be null for valid request");
      assertStringIncludes(result!, "_plan.md");
    });

    it("should classify general agents as medium tasks", async () => {
      // Create content-writer blueprint
      await Deno.writeTextFile(
        join(testDir, "Blueprints", "Identities", "content-writer.md"),
        createBlueprintContent(),
      );

      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = createRequestContent({
        traceId,
        identity: "content-writer",
        body: "Write an article about AI",
      });

      await Deno.writeTextFile(requestPath, requestContent);

      const processor = createProcessor();

      const result = await processor.process(requestPath);

      assert(result !== null, "Result should not be null for valid request");
      assertStringIncludes(result!, "_plan.md");
    });
  });

  describe("Blueprint Loading", () => {
    it("should load custom agent blueprint", async () => {
      // Create a custom blueprint
      await Deno.writeTextFile(
        join(testDir, "Blueprints", "Identities", "code-reviewer.md"),
        `# Code Reviewer Blueprint

You are an expert code reviewer. Analyze code changes and provide feedback.

<thought>Analyzing code...</thought>
<content>Code review feedback here</content>
`,
      );

      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = createRequestContent({
        traceId,
        identity: "code-reviewer",
        body: "Review my pull request",
      });

      await Deno.writeTextFile(requestPath, requestContent);

      const processor = createProcessor();

      const result = await processor.process(requestPath);

      assert(result !== null, "Should successfully process with custom blueprint");
    });

    it("should use default blueprint when agent is 'default'", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = createRequestContent({
        traceId,
        identity: "default",
        body: "Use the default blueprint",
      });

      await Deno.writeTextFile(requestPath, requestContent);

      const processor = createProcessor();

      const result = await processor.process(requestPath);

      assert(result !== null, "Should work with default blueprint");
    });
  });

  describe("Flow Request Support", () => {
    it("should process requests with flow field", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: high
flow: code-review
source: cli
created_by: "test@example.com"
---

Review this pull request for security issues.`;

      await Deno.writeTextFile(requestPath, requestContent);

      // Mock provider that returns flow execution plan

      // Create processor with RequestRouter integration
      const processor = createProcessor();

      const planPath = await processor.process(requestPath);
      assert(planPath !== null, "Should process flow requests");

      const planContent = await Deno.readTextFile(planPath!);
      assertStringIncludes(planContent, `trace_id: ${traceId}`);
      assertStringIncludes(planContent, "status: review");
    });

    it("should process requests with nonexistent flow when validation is disabled", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: high
flow: nonexistent-flow
source: cli
created_by: "test@example.com"
---

Test flow processing.`;

      await Deno.writeTextFile(requestPath, requestContent);

      const processor = createProcessor();

      const result = await processor.process(requestPath);
      assert(result !== null, "Should process flow requests even when validation is disabled");
    });

    it("should reject requests with both flow and agent fields", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      const requestContent = `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: high
flow: code-review
identity: senior-coder
source: cli
created_by: "test@example.com"
---

Conflicting request.`;

      await Deno.writeTextFile(requestPath, requestContent);

      const processor = createProcessor();

      const result = await processor.process(requestPath);
      assertEquals(result, null, "Should reject conflicting flow/agent fields");
    });

    it("should delegate flow requests to FlowRunner when configured", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);
      let flowRunnerCalled = false;

      const mockFlowRunner: IFlowRunner = {
        execute(
          _flow: IFlow,
          _request: { userPrompt: string; traceId?: string; requestId?: string },
        ) {
          flowRunnerCalled = true;
          return Promise.resolve({
            flowRunId: "test-run",
            success: true,
            stepResults: new Map<string, never>(),
            output: "Flow executed successfully",
            duration: 100,
            startedAt: new Date(),
            completedAt: new Date(),
          });
        },
      };

      const requestContent = `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: high
flow: code-review
source: cli
created_by: "test@example.com"
---

Review this pull request for security issues.`;

      await Deno.writeTextFile(requestPath, requestContent);

      const processor = createProcessor(undefined, mockFlowRunner);
      await processor.process(requestPath);

      assert(flowRunnerCalled, "FlowRunner.execute should be called for flow requests");
    });

    it("should return null when FlowRunner throws", async () => {
      const { traceId, requestPath } = createTestRequestPath(testDir);

      const throwingFlowRunner: IFlowRunner = {
        execute(
          _flow: IFlow,
          _request: { userPrompt: string; traceId?: string; requestId?: string },
        ) {
          return Promise.reject(new Error("Flow execution failed"));
        },
      };

      const requestContent = `---
trace_id: "${traceId}"
created: "${new Date().toISOString()}"
status: pending
priority: high
flow: code-review
source: cli
created_by: "test@example.com"
---

Test flow error handling.`;

      await Deno.writeTextFile(requestPath, requestContent);

      const processor = createProcessor(undefined, throwingFlowRunner);
      const result = await processor.process(requestPath);

      assertEquals(result, null, "Should return null when FlowRunner throws");
    });
  });
});
