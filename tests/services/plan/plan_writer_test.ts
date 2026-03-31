/**
 * @module PlanWriterTest
 * @path tests/services/plan/plan_writer_test.ts
 * @description Verifies the PlanWriter service, ensuring that agent-generated task
 * descriptions are correctly persisted with stable frontmatter and sequential identifiers.
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertStringIncludes } from "@std/assert";

import { PlanWriter } from "../../../src/services/plan/plan_writer.ts";
import type { IPlanWriterConfig, IRequestMetadata } from "../../../src/services/plan/plan_writer.ts";

interface IAgentExecutionResult {
  thought: string;
  content: string;
  raw: string;
}

/**
 * Helper: Create a minimal valid JSON plan
 */
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
      assertStringIncludes(result.content, 'trace_id: "trace-123"');
      assertStringIncludes(result.content, 'request_id: "test-id"');
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
});
