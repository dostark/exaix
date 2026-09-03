/**
 * @module FlowReporterTest
 * @path packages/flow/tests/flow_reporter_test.ts
 * @related-files []
 * @architectural-layer Flow
 * @description TODO: Add description
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { FlowReporter, type IFlowReportConfig, type IFlowResult, type IStepResult } from "@exaix/flow";
import { createMockConfig, initTestDbService, TEST_MODEL_OPENAI, TEST_PROVIDER_ID_OPENAI } from "@exaix/testing";
import type { IFlow, IFlowInput } from "@exaix/schemas/flow.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { DEFAULT_FLOW_VERSION } from "@exaix/core";

describe("FlowReporter", () => {
  let tempDir: string;
  let cleanup: () => Promise<void>;
  let config: Config;
  let reportConfig: IFlowReportConfig;
  let reporter: FlowReporter;

  beforeEach(async () => {
    const dbResult = await initTestDbService();
    tempDir = dbResult.tempDir;
    cleanup = dbResult.cleanup;
    config = createMockConfig(tempDir);

    reportConfig = {
      reportsDirectory: join(tempDir, "Memory", "Reports"),
      db: dbResult.db,
    };

    // Ensure reports directory exists
    await Deno.mkdir(reportConfig.reportsDirectory, { recursive: true });

    reporter = new FlowReporter(config, reportConfig);
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should initialize with valid config", () => {
      assertExists(reporter);
    });

    it("should initialize without database", () => {
      const configWithoutDb = { ...reportConfig, db: undefined };
      const reporterWithoutDb = new FlowReporter(config, configWithoutDb);
      assertExists(reporterWithoutDb);
    });
  });

  describe("generate", () => {
    function makeMinimalFlowInput(
      id: string,
      name: string,
      description: string,
      stepName: string = "Step 1",
      maxParallelism: number = 1,
    ): IFlowInput {
      return {
        id,
        name,
        description,
        version: DEFAULT_FLOW_VERSION,
        steps: [{
          id: "step1",
          name: stepName,
          agent_role: "test-agent",
          dependsOn: [],
          input: {
            source: FlowInputSource.REQUEST,
            transform: "passthrough",
          },
          retry: {
            maxAttempts: 1,
            backoffMs: 1000,
          },
        }],
        output: {
          from: "step1",
          format: FlowOutputFormat.MARKDOWN,
        },
        settings: {
          maxParallelism,
          failFast: true,
        },
      };
    }

    function makeSuccessStepResult(content: string, raw: string): Map<string, IStepResult> {
      return new Map<string, IStepResult>([
        [
          "step1",
          {
            stepId: "step1",
            success: true,
            duration: 100,
            startedAt: new Date("2025-01-01T10:00:00Z"),
            completedAt: new Date("2025-01-01T10:00:00.100Z"),
            result: {
              thought: "Completed",
              content,
              raw,
            },
          },
        ],
      ]);
    }

    it("should generate report for successful flow execution", async () => {
      // Create mock flow data
      const flow: IFlowInput = {
        id: "test-flow",
        name: "Test Flow",
        description: "A test flow",
        version: DEFAULT_FLOW_VERSION,
        steps: [
          {
            id: "step1",
            name: "First Step",
            agent_role: "test-agent",
            dependsOn: [],
            input: {
              source: FlowInputSource.REQUEST,
              transform: "passthrough",
            },
            retry: {
              maxAttempts: 1,
              backoffMs: 1000,
            },
          },
          {
            id: "step2",
            name: "Second Step",
            agent_role: "test-agent",
            dependsOn: ["step1"],
            input: {
              source: FlowInputSource.REQUEST,
              transform: "passthrough",
            },
            retry: {
              maxAttempts: 1,
              backoffMs: 1000,
            },
          },
        ],
        output: {
          from: "step2",
          format: FlowOutputFormat.MARKDOWN,
        },
        settings: {
          maxParallelism: 3,
          failFast: true,
        },
      };

      const stepResults = new Map<string, IStepResult>([
        [
          "step1",
          {
            stepId: "step1",
            success: true,
            duration: 1000,
            startedAt: new Date("2025-01-01T10:00:00Z"),
            completedAt: new Date("2025-01-01T10:00:01Z"),
            result: {
              thought: "Step 1 reasoning",
              content: "Step 1 output",
              raw: "Raw response 1",
            },
          },
        ],
        [
          "step2",
          {
            stepId: "step2",
            success: true,
            duration: 2000,
            startedAt: new Date("2025-01-01T10:00:02Z"),
            completedAt: new Date("2025-01-01T10:00:04Z"),
            result: {
              thought: "Step 2 reasoning",
              content: "Step 2 output",
              raw: "Raw response 2",
            },
          },
        ],
      ]);

      const flowResult: IFlowResult = {
        flowRunId: "run-123-456",
        success: true,
        stepResults,
        output: "Final aggregated output",
        duration: 4000,
        startedAt: new Date("2025-01-01T10:00:00Z"),
        completedAt: new Date("2025-01-01T10:00:04Z"),
        tokenSummary: {
          input_tokens: 300,
          output_tokens: 120,
          total_tokens: 420,
          token_provider: TEST_PROVIDER_ID_OPENAI,
          token_model: TEST_MODEL_OPENAI,
          token_cost_usd: 0.01,
        },
      };

      const requestId = "request-abc123";

      // Generate report
      const result = await reporter.generate(flow as IFlow, flowResult, requestId);

      // Verify result structure
      assertExists(result.reportPath);
      assertExists(result.content);
      assertExists(result.createdAt);

      // Verify file was created
      assertEquals(await exists(result.reportPath), true);

      // Verify content includes required sections
      assertStringIncludes(result.content, 'type: "flow_report"');
      assertStringIncludes(result.content, 'flow: "test-flow"');
      assertStringIncludes(result.content, 'flow_run_id: "run-123-456"');
      assertStringIncludes(result.content, "success: true");
      assertStringIncludes(result.content, 'request_id: "request-abc123"');
      assertStringIncludes(result.content, "input_tokens: 300");
      assertStringIncludes(result.content, "output_tokens: 120");
      assertStringIncludes(result.content, "total_tokens: 420");
      assertStringIncludes(result.content, 'token_provider: "' + TEST_PROVIDER_ID_OPENAI + '"');
      assertStringIncludes(result.content, 'token_model: "' + TEST_MODEL_OPENAI + '"');
      assertStringIncludes(result.content, "token_cost_usd: 0.01");
      assertStringIncludes(result.content, "# IFlow Report: Test Flow");
      assertStringIncludes(result.content, "## Execution Summary");
      assertStringIncludes(result.content, "## Step Outputs");
      assertStringIncludes(result.content, "## Dependency Graph");
    });

    it("should generate report for failed flow execution", async () => {
      // Create mock flow data with failure
      const flow = makeMinimalFlowInput(
        "failed-flow",
        "Failed Flow",
        "A flow that fails",
        "Failing Step",
        3,
      );

      const stepResults = new Map<string, IStepResult>([
        [
          "step1",
          {
            stepId: "step1",
            success: false,
            error: "Agent execution failed",
            duration: 500,
            startedAt: new Date("2025-01-01T10:00:00Z"),
            completedAt: new Date("2025-01-01T10:00:00.500Z"),
          },
        ],
      ]);

      const flowResult: IFlowResult = {
        flowRunId: "run-789-012",
        success: false,
        stepResults,
        output: "",
        duration: 500,
        startedAt: new Date("2025-01-01T10:00:00Z"),
        completedAt: new Date("2025-01-01T10:00:00.500Z"),
      };

      // Generate report
      const result = await reporter.generate(flow as IFlow, flowResult);

      // Verify content indicates failure
      assertStringIncludes(result.content, "success: false");
      assertStringIncludes(result.content, "steps_failed: 1");
      assertStringIncludes(result.content, "steps_completed: 0");
      assertStringIncludes(result.content, "❌ Failed");
      assertStringIncludes(result.content, "Agent execution failed");
    });

    it("should include namespace artifact metadata when present", async () => {
      const flow = makeMinimalFlowInput(
        "namespace-flow",
        "Namespace Flow",
        "A flow with shared namespace output",
      );

      const stepResults = makeSuccessStepResult(
        "Namespace-enabled output",
        "raw namespace output",
      );

      const namespaceArtifactPath = join(
        tempDir,
        "Memory",
        "Execution",
        "trace-123",
        "namespace.md",
      );

      const flowResult: IFlowResult = {
        flowRunId: "run-namespace-123",
        success: true,
        stepResults,
        output: "Namespace-enabled output",
        duration: 100,
        startedAt: new Date("2025-01-01T10:00:00Z"),
        completedAt: new Date("2025-01-01T10:00:00.100Z"),
        namespaceArtifactPath,
      };

      const result = await reporter.generate(flow as IFlow, flowResult);

      assertStringIncludes(result.content, `namespace_artifact_path: "${namespaceArtifactPath}"`);
      assertStringIncludes(result.content, "## Shared Namespace");
      assertStringIncludes(result.content, namespaceArtifactPath);
    });

    it("should omit shared namespace section when namespace artifact is absent", async () => {
      const flow = makeMinimalFlowInput(
        "no-namespace-flow",
        "No Namespace Flow",
        "A flow without shared namespace output",
      );

      const stepResults = makeSuccessStepResult(
        "Output without namespace",
        "raw output",
      );

      const flowResult: IFlowResult = {
        flowRunId: "run-no-namespace-123",
        success: true,
        stepResults,
        output: "Output without namespace",
        duration: 100,
        startedAt: new Date("2025-01-01T10:00:00Z"),
        completedAt: new Date("2025-01-01T10:00:00.100Z"),
      };

      const result = await reporter.generate(flow as IFlow, flowResult);

      assert(!result.content.includes("namespace_artifact_path:"));
      assert(!result.content.includes("## Shared Namespace"));
    });

    it("should generate correct filename format", async () => {
      // Create minimal mock data
      const flow = makeMinimalFlowInput(
        "filename-test",
        "Filename Test",
        "Test filename generation",
        "Step 1",
        3,
      );

      const stepResults = new Map<string, IStepResult>([
        [
          "step1",
          {
            stepId: "step1",
            success: true,
            duration: 100,
            startedAt: new Date(),
            completedAt: new Date(),
            result: {
              thought: "Output reasoning",
              content: "output",
              raw: "raw output",
            },
          },
        ],
      ]);

      const flowResult: IFlowResult = {
        flowRunId: "run-abc-def-ghi",
        success: true,
        stepResults,
        output: "output",
        duration: 100,
        startedAt: new Date(),
        completedAt: new Date(),
      };

      const result = await reporter.generate(flow as IFlow, flowResult);

      // Filename should match pattern: flow_{flowId}_{shortRunId}_{timestamp}.md
      const filename = result.reportPath.split("/").pop()!;
      assertStringIncludes(filename, "flow_filename-test_run-abc-_");
      assertStringIncludes(filename, ".md");
    });
  });
});
