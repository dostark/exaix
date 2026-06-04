// deno-lint-ignore-file no-explicit-any
/**
 * @module PlanWriterTest
 * @path packages/routing/tests/plan_writer_test.ts
 * @description Verifies the PlanWriter service, ensuring that agent-generated task
 * descriptions are correctly persisted with stable frontmatter and sequential identifiers.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { spy, type SpyCall } from "@std/testing/mock";

import { PlanWriter } from "@exaix/core/planning";
import type { IAgentExecutionResult, IPlanWriterConfig, IRequestMetadata } from "@exaix/core/planning";
import type { IDatabaseService } from "@exaix/core/types";
import type { IActivityRecord } from "@exaix/core/types";
import { EventLogger } from "@exaix/core/logger";

/**
 * Helper: Retrieve calls from a spy
 */
function getSpyCalls(fn: any): SpyCall[] {
  return (fn as { calls: SpyCall[] })?.calls ?? [];
}
function createJsonPlan(
  subject: string,
  description: string,
  steps: Array<{ title: string; description: string }> = [{
    title: "Default Step",
    description: "Default description",
  }],
): string {
  return JSON.stringify({
    subject,
    description,
    steps: steps.map((s, i) => ({
      step: i + 1,
      title: s.title,
      description: s.description,
    })),
  });
}

describe("PlanWriter - JSON Integration", () => {
  let testDir: string;
  let plansDir: string;
  let knowledgeDir: string;
  let config: IPlanWriterConfig;
  let planWriter: PlanWriter;

  beforeEach(async () => {
    testDir = await Deno.makeTempDir({ prefix: "plan_writer_json_test_" });
    plansDir = `${testDir}/Workspace/Plans`;
    knowledgeDir = `${testDir}/Memory`;

    await Deno.mkdir(plansDir, { recursive: true });
    await Deno.mkdir(knowledgeDir, { recursive: true });

    config = {
      plansDirectory: plansDir,
      includeReasoning: true,
      generateWikiLinks: true,
      runtimeRoot: `${testDir}/System`,
    };

    planWriter = new PlanWriter(config);
  });

  afterEach(async () => {
    await Deno.remove(testDir, { recursive: true });
  });

  describe("JSON Plan Validation", () => {
    it("should accept valid JSON plan", async () => {
      const agentResult: IAgentExecutionResult = {
        thought: "Creating plan...",
        content: createJsonPlan("Implement Auth", "Add authentication system"),
        raw: "",
      };

      const metadata: IRequestMetadata = {
        requestId: "implement-auth",
        traceId: "test-trace-id",
        createdAt: new Date(),
        contextFiles: [],
        contextWarnings: [],
        identityId: "test-agent",
      };

      const result = await planWriter.writePlan(agentResult, metadata);

      assertStringIncludes(result.planPath, "implement-auth_plan.md");
      assertStringIncludes(result.content, "# Implement Auth");
    });

    it("should convert JSON to markdown with steps", async () => {
      const agentResult: IAgentExecutionResult = {
        thought: "Planning steps...",
        content: createJsonPlan("My Plan", "Plan description", [
          { title: "Step One", description: "First step" },
          { title: "Step Two", description: "Second step" },
        ]),
        raw: "",
      };

      const metadata: IRequestMetadata = {
        requestId: "test-plan",
        traceId: "test-trace",
        createdAt: new Date(),
        contextFiles: [],
        contextWarnings: [],
        identityId: "test-agent",
      };

      const result = await planWriter.writePlan(agentResult, metadata);

      assertStringIncludes(result.content, "## Step 1: Step One");
      assertStringIncludes(result.content, "First step");
      assertStringIncludes(result.content, "## Step 2: Step Two");
      assertStringIncludes(result.content, "Second step");
    });
  });

  describe("Frontmatter and Metadata", () => {
    it("should include YAML frontmatter", async () => {
      const agentResult: IAgentExecutionResult = {
        thought: "Test",
        content: createJsonPlan("Test Plan", "Test description"),
        raw: "",
      };

      const metadata: IRequestMetadata = {
        requestId: "test-id",
        traceId: "trace-123",
        createdAt: new Date("2024-11-25T10:00:00Z"),
        contextFiles: [],
        contextWarnings: [],
        identityId: "test-agent",
      };

      const result = await planWriter.writePlan(agentResult, metadata);

      // Check frontmatter structure
      assert(result.content.startsWith("---\n"));
      assertStringIncludes(result.content, "trace_id: trace-123");
      assertStringIncludes(result.content, "request_id: test-id");
      assertStringIncludes(result.content, "status: review");
    });

    it("should include reasoning section", async () => {
      const agentResult: IAgentExecutionResult = {
        thought: "This is my reasoning about the plan",
        content: createJsonPlan("Plan", "Description"),
        raw: "",
      };

      const metadata: IRequestMetadata = {
        requestId: "test",
        traceId: "trace",
        createdAt: new Date(),
        contextFiles: [],
        contextWarnings: [],
        identityId: "test-agent",
      };

      const result = await planWriter.writePlan(agentResult, metadata);

      assertStringIncludes(result.content, "## Reasoning");
      assertStringIncludes(result.content, "This is my reasoning");
    });
  });

  describe("Context References", () => {
    it("should include context files", async () => {
      await Deno.writeTextFile(`${knowledgeDir}/Doc1.md`, "Doc content");
      await Deno.writeTextFile(`${knowledgeDir}/Doc2.md`, "Doc content");

      const agentResult: IAgentExecutionResult = {
        thought: "Using docs",
        content: createJsonPlan("Plan", "Description"),
        raw: "",
      };

      const metadata: IRequestMetadata = {
        requestId: "test",
        traceId: "trace",
        createdAt: new Date(),
        contextFiles: [
          `${knowledgeDir}/Doc1.md`,
          `${knowledgeDir}/Doc2.md`,
        ],
        contextWarnings: [],
      };

      const result = await planWriter.writePlan(agentResult, metadata);

      assertStringIncludes(result.content, "## Context References");
      assertStringIncludes(result.content, "[[Doc1]]");
      assertStringIncludes(result.content, "[[Doc2]]");
    });

    it("should include context warnings", async () => {
      const agentResult: IAgentExecutionResult = {
        thought: "Test",
        content: createJsonPlan("Plan", "Description"),
        raw: "",
      };

      const metadata: IRequestMetadata = {
        requestId: "test",
        traceId: "trace",
        createdAt: new Date(),
        contextFiles: [`${knowledgeDir}/Doc1.md`], // Need at least one context file for warnings to show
        contextWarnings: ["Warning 1", "Warning 2"],
        identityId: "test-agent",
      };

      const result = await planWriter.writePlan(agentResult, metadata);

      assertStringIncludes(result.content, "**Context Warnings:**");
      assertStringIncludes(result.content, "Warning 1");
      assertStringIncludes(result.content, "Warning 2");
    });
  });

  describe("File I/O", () => {
    it("should write plan to correct file path", async () => {
      const agentResult: IAgentExecutionResult = {
        thought: "Test",
        content: createJsonPlan("Plan", "Description"),
        raw: "",
      };

      const metadata: IRequestMetadata = {
        requestId: "my-feature",
        traceId: "trace",
        createdAt: new Date(),
        identityId: "test-agent",
        contextFiles: [],
        contextWarnings: [],
      };

      const result = await planWriter.writePlan(agentResult, metadata);

      assertStringIncludes(result.planPath, "my-feature_plan.md");

      const fileExists = await Deno.stat(result.planPath)
        .then(() => true)
        .catch(() => false);

      assert(fileExists, "Plan file should exist");
    });
  });

  describe("Token Usage and Database Integration", () => {
    it("should aggregate token usage from database", async () => {
      const traceId = "usage-trace";
      const db: Partial<IDatabaseService> = {
        queryActivity: spy(() =>
          Promise.resolve([
            {
              id: "ev1",
              trace_id: traceId,
              actor: "agent",
              actor_type: "agent",
              action_type: "llm.usage",
              target: "p1",
              payload: JSON.stringify({
                input_tokens: 100,
                output_tokens: 50,
                cost_usd: 0.001,
                provider: "p1",
                model: "m1",
              }),
              timestamp: new Date().toISOString(),
              identity_id: null,
            },
            {
              id: "ev2",
              trace_id: traceId,
              actor: "agent",
              actor_type: "agent",
              action_type: "llm.usage",
              target: "p2",
              payload: JSON.stringify({
                prompt_tokens: 200,
                completion_tokens: 100,
                cost_usd: 0.002,
                provider: "p2",
                model: "m2",
              }),
              timestamp: new Date().toISOString(),
              identity_id: null,
            },
          ] as IActivityRecord[])
        ),
        logActivity: spy(() => Promise.resolve()),
      };

      const planWriterWithDb = new PlanWriter({ ...config, db: db as IDatabaseService });

      const agentResult: IAgentExecutionResult = {
        thought: "test",
        content: createJsonPlan("Test", "Desc"),
        raw: "",
      };

      const metadata: IRequestMetadata = {
        requestId: "req-1",
        traceId,
        createdAt: new Date(),
        contextFiles: [],
        contextWarnings: [],
      };

      const result = await planWriterWithDb.writePlan(agentResult, metadata);

      assertStringIncludes(result.content, "input_tokens: 300");
      assertStringIncludes(result.content, "output_tokens: 150");
      assertStringIncludes(result.content, "total_tokens: 450");
      assertStringIncludes(result.content, "token_cost_usd: 0.003");
      // Providers and models are aggregated
      assertStringIncludes(result.content, "p1, p2");
      assertStringIncludes(result.content, "m1, m2");
    });
  });

  describe("Plan Validation Errors", () => {
    it("should log and throw PlanValidationError on invalid JSON", async () => {
      const mockDb: Partial<IDatabaseService> = {
        logActivity: spy(() => Promise.resolve()),
        waitForFlush: () => Promise.resolve(),
      };
      const logger = new EventLogger({ db: mockDb as IDatabaseService });
      const planWriterWithDb = new PlanWriter({ ...config, logger });

      const agentResult: IAgentExecutionResult = {
        thought: "bad plan",
        content: "invalid json",
        raw: "RAW_DATA",
      };

      const metadata: IRequestMetadata = {
        requestId: "bad-req",
        traceId: "trace-bad",
        createdAt: new Date(),
        contextFiles: [],
        contextWarnings: [],
      };

      try {
        await planWriterWithDb.writePlan(agentResult, metadata);
        assert(false, "Should have thrown PlanValidationError");
      } catch (e: any) {
        assertEquals((e as Error).name, "PlanValidationError");
        // Verify enrichment
        const details = (e as { details?: { fullRawResponse?: string } }).details;
        if (details?.fullRawResponse) {
          assertEquals(details.fullRawResponse, "RAW_DATA");
        } else {
          throw new Error("Missing fullRawResponse in error details");
        }
      }

      // Verify failure was logged
      const failureLog = getSpyCalls(mockDb.logActivity).find((c) =>
        (c.args[1] as string) === "plan.validation.failed"
      );
      assert(failureLog, "Failure should be logged");
    });
  });

  describe("Subject Priority", () => {
    it("should use agent subject if request subject is fallback", async () => {
      const agentResult: IAgentExecutionResult = {
        thought: "test",
        content: createJsonPlan("Agent Subject", "Desc"),
        raw: "",
      };

      const metadata: IRequestMetadata = {
        requestId: "id",
        traceId: "t",
        createdAt: new Date(),
        contextFiles: [],
        contextWarnings: [],
        subject: "Fallback Request Subject",
        subjectIsFallback: true,
      };

      const result = await planWriter.writePlan(agentResult, metadata);
      assertStringIncludes(result.content, "# Agent Subject");
      assertEquals(result.subject, "Agent Subject");
    });

    it("should prefer explicit request subject over agent subject", async () => {
      const agentResult: IAgentExecutionResult = {
        thought: "test",
        content: createJsonPlan("Agent Subject", "Desc"),
        raw: "",
      };

      const metadata: IRequestMetadata = {
        requestId: "id",
        traceId: "t",
        createdAt: new Date(),
        contextFiles: [],
        contextWarnings: [],
        subject: "Explicit Request Subject",
        subjectIsFallback: false,
      };

      const result = await planWriter.writePlan(agentResult, metadata);
      // It should be in frontmatter
      assertStringIncludes(result.content, "subject: Explicit Request Subject");
      assertEquals(result.subject, "Explicit Request Subject");
      // Note: Current implementation renders agentSubject in markdown header even if overridden in frontmatter
      // This is expected given the current PlanWriter logic
      assertStringIncludes(result.content, "# Agent Subject");
    });
  });

  describe("Configuration Options", () => {
    it("should respect includeReasoning: false", async () => {
      const pwNoReasoning = new PlanWriter({ ...config, includeReasoning: false });
      const agentResult: IAgentExecutionResult = {
        thought: "MY REASONING",
        content: createJsonPlan("Plan", "Desc"),
        raw: "",
      };
      const metadata: IRequestMetadata = {
        requestId: "id",
        traceId: "t",
        createdAt: new Date(),
        contextFiles: [],
        contextWarnings: [],
      };

      const result = await pwNoReasoning.writePlan(agentResult, metadata);
      assert(!result.content.includes("## Reasoning"), "Should NOT include reasoning");
      assert(!result.content.includes("MY REASONING"), "Should NOT include reasoning text");
    });

    it("should respect generateWikiLinks: false", async () => {
      const pwNoWiki = new PlanWriter({ ...config, generateWikiLinks: false });
      const agentResult: IAgentExecutionResult = {
        thought: "test",
        content: createJsonPlan("Plan", "Desc"),
        raw: "",
      };
      const metadata: IRequestMetadata = {
        requestId: "id",
        traceId: "t",
        createdAt: new Date(),
        contextFiles: ["path/to/File.md"],
        contextWarnings: [],
      };

      const result = await pwNoWiki.writePlan(agentResult, metadata);
      assertStringIncludes(result.content, "- path/to/File.md");
      assert(!result.content.includes("[[File]]"), "Should NOT use wiki links");
    });
  });
});
