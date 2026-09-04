/**
 * @module FlowSchemaTest
 * @path packages/schemas/tests/flow_schema_test.ts
 * @related-files []
 * @architectural-layer Schemas
 * @description Verifies the Zod schemas for agentic workflows, ensuring strict
 * validation of steps, inputs, and output formats.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  DEFAULT_FLOW_VERSION,
  FlowInputSource,
  FlowOutputFormat,
  FlowStepExecutionMode,
  FlowStepType,
  ProviderCostTier,
} from "@exaix/core";
import { type z, ZodError } from "zod";
import { FlowSchema, FlowStepSchema } from "@exaix/schemas";

// Test FlowStep schema validation
Deno.test("FlowStepSchema: validates valid step definition", () => {
  const validStep = {
    id: "analyze-code",
    name: "Analyze Codebase",
    agent_role: "senior-coder",
    dependsOn: ["setup"],
    input: {
      source: FlowInputSource.REQUEST,
      transform: "passthrough",
    },
    timeout: 30000,
    retry: {
      maxAttempts: 2,
      backoffMs: 1000,
    },
  };

  const result = FlowStepSchema.parse(validStep);
  assertEquals(result.id, "analyze-code");
  assertEquals(result.name, "Analyze Codebase");
  assertEquals(result.agent_role, "senior-coder");
  assertEquals(result.dependsOn, ["setup"]);
  assertEquals(result.input.source, FlowInputSource.REQUEST);
  assertEquals(result.timeout, 30000);
  assertEquals(result.retry.maxAttempts, 2);
});

Deno.test("FlowStepSchema: requires id, name, and agent role fields", () => {
  // Test missing all required fields
  assertThrows(
    () => FlowStepSchema.parse({}),
    ZodError,
  );

  // Test missing id
  assertThrows(
    () => FlowStepSchema.parse({ name: "Test", agent_role: "test-agent" }),
    ZodError,
  );

  // Test missing name
  assertThrows(
    () => FlowStepSchema.parse({ id: "test", agent_role: "test-agent" }),
    ZodError,
  );

  // Test missing agent role
  assertThrows(
    () => FlowStepSchema.parse({ id: "test", name: "Test" }),
    ZodError,
  );
});

Deno.test("FlowStepSchema: validates input source enum values", () => {
  const validSources = [FlowInputSource.REQUEST, FlowInputSource.STEP, FlowInputSource.AGGREGATE];

  for (const source of validSources) {
    const step = {
      id: "test",
      name: "Test",
      agent_role: "test-agent",
      input: { source },
    };
    assertEquals(FlowStepSchema.parse(step).input.source, source);
  }

  // Invalid source
  assertThrows(
    () =>
      FlowStepSchema.parse({
        id: "test",
        name: "Test",
        agent_role: "test-agent",
        input: { source: "invalid" },
      }),
    ZodError,
  );
});

Deno.test("FlowStepSchema: applies default values for optional fields", () => {
  const minimalStep = {
    id: "test",
    name: "Test Step",
    agent_role: "test-agent",
  };

  const result = FlowStepSchema.parse(minimalStep);
  assertEquals(result.dependsOn, []);
  assertEquals(result.input.source, FlowInputSource.REQUEST);
  assertEquals(result.input.transform, "passthrough");
  assertEquals(result.retry.maxAttempts, 1);
  assertEquals(result.retry.backoffMs, 1000);
});

Deno.test("FlowStepSchema: validates dependsOn as array of strings", () => {
  // Valid array
  const validStep = {
    id: "test",
    name: "Test",
    agent_role: "test-agent",
    dependsOn: ["step1", "step2"],
  };

  assertEquals(FlowStepSchema.parse(validStep).dependsOn, ["step1", "step2"]);

  // Invalid: not an array
  assertThrows(
    () =>
      FlowStepSchema.parse({
        id: "test",
        name: "Test",
        agent_role: "test-agent",
        dependsOn: "invalid",
      }),
    ZodError,
  );

  // Invalid: array of non-strings
  assertThrows(
    () =>
      FlowStepSchema.parse({
        id: "test",
        name: "Test",
        agent_role: "test-agent",
        dependsOn: [123, 456],
      }),
    ZodError,
  );
});

Deno.test("FlowStepSchema: validates timeout as number", () => {
  const validStep = {
    id: "test",
    name: "Test",
    agent_role: "test-agent",
    timeout: 5000,
  };
  assertEquals(FlowStepSchema.parse(validStep).timeout, 5000);

  // Invalid timeout
  assertThrows(
    () =>
      FlowStepSchema.parse({
        id: "test",
        name: "Test",
        agent_role: "test-agent",
        timeout: "invalid",
      }),
    ZodError,
  );
});

Deno.test("FlowStepSchema: validates retry configuration", () => {
  const validStep = {
    id: "test",
    name: "Test",
    agent_role: "test-agent",
    retry: {
      maxAttempts: 3,
      backoffMs: 2000,
    },
  };

  const result = FlowStepSchema.parse(validStep);
  assertEquals(result.retry.maxAttempts, 3);
  assertEquals(result.retry.backoffMs, 2000);

  // Invalid maxAttempts
  assertThrows(
    () =>
      FlowStepSchema.parse({
        id: "test",
        name: "Test",
        agent_role: "test-agent",
        retry: {
          maxAttempts: "invalid",
          backoffMs: 1000,
        },
      }),
    ZodError,
  );
});

// Test Flow schema validation
Deno.test("FlowSchema: validates complete flow definition", () => {
  const validFlow = {
    id: "code-review",
    name: "Code Review Flow",
    description: "Automated code review process",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "lint",
        name: "Lint Code",
        agent_role: "linter-agent",
      },
      {
        id: "review",
        name: "Review Code",
        agent_role: "reviewer-agent",
        dependsOn: ["lint"],
      },
    ],
    output: {
      from: ["review"],
      format: FlowOutputFormat.MARKDOWN,
    },
    settings: {
      maxParallelism: 2,
      failFast: true,
      timeout: 60000,
    },
  };

  const result = FlowSchema.parse(validFlow);
  assertEquals(result.id, "code-review");
  assertEquals(result.name, "Code Review Flow");
  assertEquals(result.steps.length, 2);
  assertEquals(result.output.from, ["review"]);
  assertEquals(result.settings.maxParallelism, 2);
});

Deno.test("FlowSchema: requires id, name, description, steps, and output", () => {
  assertThrows(
    () => FlowSchema.parse({}),
    ZodError,
  );

  assertThrows(
    () => FlowSchema.parse({ id: "test", name: "Test" }),
    ZodError,
  );
});

Deno.test("FlowSchema: validates steps array", () => {
  const flowWithSteps = {
    id: "test",
    name: "Test Flow",
    description: "Test description",
    steps: [
      {
        id: "step1",
        name: "Step 1",
        agent_role: "agent1",
      },
    ],
    output: {
      from: ["step1"],
      format: FlowOutputFormat.MARKDOWN,
    },
  };

  const result = FlowSchema.parse(flowWithSteps);
  assertEquals(result.steps.length, 1);

  // Invalid: empty steps array
  assertThrows(
    () =>
      FlowSchema.parse({
        id: "test",
        name: "Test",
        description: "Test",
        steps: [],
        output: { from: [], format: FlowOutputFormat.MARKDOWN },
      }),
    ZodError,
  );

  // Invalid: steps not array
  assertThrows(
    () =>
      FlowSchema.parse({
        id: "test",
        name: "Test",
        description: "Test",
        steps: "invalid",
        output: { from: [], format: FlowOutputFormat.MARKDOWN },
      }),
    ZodError,
  );
});

Deno.test("FlowSchema: validates output configuration", () => {
  const validOutputs = [FlowOutputFormat.MARKDOWN, FlowOutputFormat.JSON, FlowOutputFormat.CONCAT];

  for (const format of validOutputs) {
    const flow = {
      id: "test",
      name: "Test",
      description: "Test",
      steps: [{ id: "step1", name: "Step 1", agent_role: "agent1" }],
      output: {
        from: ["step1"],
        format,
      },
    };
    assertEquals(FlowSchema.parse(flow).output.format, format);
  }

  // Invalid format
  assertThrows(
    () =>
      FlowSchema.parse({
        id: "test",
        name: "Test",
        description: "Test",
        steps: [{ id: "step1", name: "Step 1", agent_role: "agent1" }],
        output: {
          from: ["step1"],
          format: "invalid",
        },
      }),
    ZodError,
  );
});

Deno.test("FlowSchema: applies default values for optional fields", () => {
  const minimalFlow = {
    id: "test",
    name: "Test Flow",
    description: "Test description",
    steps: [
      {
        id: "step1",
        name: "Step 1",
        agent_role: "agent1",
      },
    ],
    output: {
      from: ["step1"],
      format: FlowOutputFormat.MARKDOWN,
    },
  };

  const result = FlowSchema.parse(minimalFlow);
  assertEquals(result.version, "1.0.0");
  assertEquals(result.settings.maxParallelism, 3);
  assertEquals(result.settings.failFast, true);
  assertEquals(result.settings.timeout, undefined); // No default
});

Deno.test("FlowSchema: validates settings configuration", () => {
  const flow = {
    id: "test",
    name: "Test",
    description: "Test",
    steps: [{ id: "step1", name: "Step 1", agent_role: "agent1" }],
    output: { from: ["step1"], format: FlowOutputFormat.MARKDOWN },
    settings: {
      maxParallelism: 5,
      failFast: false,
      timeout: 120000,
    },
  };

  const result = FlowSchema.parse(flow);
  assertEquals(result.settings.maxParallelism, 5);
  assertEquals(result.settings.failFast, false);
  assertEquals(result.settings.timeout, 120000);

  // Invalid maxParallelism
  assertThrows(
    () =>
      FlowSchema.parse({
        ...flow,
        settings: {
          maxParallelism: "invalid",
          failFast: true,
        },
      }),
    ZodError,
  );
});

// Integration test for schema importability
Deno.test("IFlow as Flow schemas: can be imported and used by other modules", () => {
  // This test ensures the schemas are properly exported
  // and can be used in type annotations and runtime validation

  // Test that we can use the schemas in type definitions
  type IFlowStep = z.infer<typeof FlowStepSchema>;
  type IFlow = z.infer<typeof FlowSchema>;

  const testStep: IFlowStep = {
    id: "test-step",
    name: "Test Step",
    type: FlowStepType.AGENT,
    agent_role: "test-agent",
    execution_mode: FlowStepExecutionMode.DECLARED,
    dependsOn: [],
    input: {
      source: FlowInputSource.REQUEST,
      transform: "passthrough",
    },
    retry: {
      maxAttempts: 1,
      backoffMs: 1000,
    },
  };

  const testFlow: IFlow = {
    id: "test-flow",
    name: "Test Flow",
    description: "Test flow description",
    version: DEFAULT_FLOW_VERSION,
    steps: [testStep],
    output: {
      from: ["test-step"],
      format: FlowOutputFormat.MARKDOWN,
    },
    settings: {
      maxParallelism: 3,
      failFast: true,
      includeRequestCriteria: false,
    },
  };

  // Verify the types work at runtime
  assertEquals(FlowStepSchema.parse(testStep).id, "test-step");
  assertEquals(FlowSchema.parse(testFlow).id, "test-flow");
});

// Tests for the tier field on FlowStepSchema (Gap UF-3)
Deno.test("FlowStepSchema: parses step with valid tier annotation", () => {
  const step = {
    id: "test",
    name: "Test",
    agent_role: "agent1",
    tier: ProviderCostTier.FREE,
  };
  const result = FlowStepSchema.parse(step);
  assertEquals(result.tier, ProviderCostTier.FREE);
});

Deno.test("FlowStepSchema: parses step with FREEMIUM tier", () => {
  const step = {
    id: "test",
    name: "Test",
    agent_role: "agent1",
    tier: ProviderCostTier.FREEMIUM,
  };
  const result = FlowStepSchema.parse(step);
  assertEquals(result.tier, ProviderCostTier.FREEMIUM);
});

Deno.test("FlowStepSchema: parses step with PAID tier", () => {
  const step = {
    id: "test",
    name: "Test",
    agent_role: "agent1",
    tier: ProviderCostTier.PAID,
  };
  const result = FlowStepSchema.parse(step);
  assertEquals(result.tier, ProviderCostTier.PAID);
});

Deno.test("FlowStepSchema: parses step with LOCAL tier", () => {
  const step = {
    id: "test",
    name: "Test",
    agent_role: "agent1",
    tier: ProviderCostTier.LOCAL,
  };
  const result = FlowStepSchema.parse(step);
  assertEquals(result.tier, ProviderCostTier.LOCAL);
});

Deno.test("FlowStepSchema: omitting tier is backward compatible", () => {
  const step = {
    id: "test",
    name: "Test",
    agent_role: "agent1",
  };
  const result = FlowStepSchema.parse(step);
  assertEquals(result.tier, undefined);
});

Deno.test("FlowStepSchema: rejects invalid tier value", () => {
  assertThrows(
    () =>
      FlowStepSchema.parse({
        id: "test",
        name: "Test",
        agent_role: "agent1",
        tier: "ULTRA_CHEAP",
      }),
    ZodError,
  );
});
