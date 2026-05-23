/**
 * @module FlowValidatorTest
 * @path tests/flows/flow_validator_test.ts
 * @description Comprehensive validation tests for the Flow YAML schema, ensuring structural
 * integrity, mandatory field presence, and early detection of malformed workflow definitions.
 */

import { assertEquals } from "@std/assert";

import { FlowLoader } from "@exaix/flow";
import { FlowValidatorImpl } from "@exaix/flow";

// Utility: create isolated temp dir for each test
async function setupTestDir() {
  return await Deno.makeTempDir({ prefix: "exa-flow-" });
}

/**
 * Create a YAML flow fixture for testing.
 * Accepts partial flow content to test various valid/invalid scenarios.
 */
function yamlFlowContent(overrides: {
  id?: string;
  name?: string;
  description?: string;
  steps?: string;
  output?: string;
} = {}): string {
  return `id: "${overrides.id ?? "test-flow"}"
name: "${overrides.name ?? "Test Flow"}"
description: "${overrides.description ?? "A test flow"}"
version: "1.0.0"
steps: ${
    overrides.steps ?? `
  - id: "s1"
    name: "Step 1"
    identity: "agent1"
    dependsOn: []
    input:
      source: "request"
      transform: "passthrough"
    retry:
      maxAttempts: 1
      backoffMs: 1000
`
  }
output: ${overrides.output ?? `{ from: "s1", format: "markdown" }`}
`;
}

Deno.test("FlowValidatorImpl: validates existing flow with valid structure", async () => {
  const dir = await setupTestDir();
  try {
    await Deno.writeTextFile(
      `${dir}/valid-flow.flow.yaml`,
      yamlFlowContent({ id: "valid-flow", name: "Valid Flow", description: "A valid flow" }),
    );
    const loader = new FlowLoader(dir);
    const validator = new FlowValidatorImpl(loader, "unused-blueprints-path");
    const result = await validator.validateFlow("valid-flow");
    if (!result.valid) console.error("Flow validation debug:", result.error ?? "(no error)");
    assertEquals(result.valid, true);
    assertEquals(result.error, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FlowValidatorImpl: fails for missing flow", async () => {
  const dir = await Deno.makeTempDir({ prefix: "exa-flow-" });
  try {
    const loader = new FlowLoader(dir);
    const validator = new FlowValidatorImpl(loader, "unused-blueprints-path");
    const result = await validator.validateFlow("nonexistent");
    assertEquals(result.valid, false);
    assertEquals(typeof result.error === "string" && (result.error ?? "").includes("not found"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FlowValidatorImpl: fails for flow with no steps", async () => {
  const dir = await setupTestDir();
  try {
    await Deno.writeTextFile(
      `${dir}/no-steps.flow.yaml`,
      yamlFlowContent({
        id: "no-steps",
        name: "No Steps",
        description: "No steps flow",
        steps: "[]",
        output: `{ from: "s1", format: "markdown" }`,
      }),
    );
    const loader = new FlowLoader(dir);
    const validator = new FlowValidatorImpl(loader, "unused-blueprints-path");
    const result = await validator.validateFlow("no-steps");
    assertEquals(result.valid, false);
    assertEquals(typeof result.error === "string" && (result.error ?? "").includes("at least one step"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FlowValidatorImpl: fails for flow with dependency cycle", async () => {
  const dir = await setupTestDir();
  try {
    const cyclicSteps = `
  - id: "a"
    name: "A"
    identity: "agentA"
    dependsOn: ["b"]
    input:
      source: "request"
      transform: "passthrough"
    retry:
      maxAttempts: 1
      backoffMs: 1000
  - id: "b"
    name: "B"
    identity: "agentB"
    dependsOn: ["a"]
    input:
      source: "request"
      transform: "passthrough"
    retry:
      maxAttempts: 1
      backoffMs: 1000
`;
    await Deno.writeTextFile(
      `${dir}/cyclic-flow.flow.yaml`,
      yamlFlowContent({
        id: "cyclic-flow",
        name: "Cyclic Flow",
        description: "Cyclic flow",
        steps: cyclicSteps,
        output: `{ from: "a", format: "markdown" }`,
      }),
    );
    const loader = new FlowLoader(dir);
    const validator = new FlowValidatorImpl(loader, "unused-blueprints-path");
    const result = await validator.validateFlow("cyclic-flow");
    assertEquals(result.valid, false);
    assertEquals(typeof result.error === "string" && (result.error ?? "").includes("invalid dependencies"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FlowValidatorImpl: fails for flow with invalid identity field", async () => {
  const dir = await setupTestDir();
  try {
    const badAgentSteps = `
  - id: "s1"
    name: "Step 1"
    identity: ""
    dependsOn: []
    input:
      source: "request"
      transform: "passthrough"
    retry:
      maxAttempts: 1
      backoffMs: 1000
`;
    await Deno.writeTextFile(
      `${dir}/bad-agent.flow.yaml`,
      yamlFlowContent({ id: "bad-agent", name: "Bad Agent", description: "Bad agent flow", steps: badAgentSteps }),
    );
    const loader = new FlowLoader(dir);
    const validator = new FlowValidatorImpl(loader, "unused-blueprints-path");
    const result = await validator.validateFlow("bad-agent");
    if (!result.valid) console.error("bad-agent debug:", result.error ?? "(no error)");
    assertEquals(result.valid, false);
    // Error comes from Zod schema validation for empty identity
    assertEquals(typeof result.error === "string" && (result.error ?? "").includes("identity"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FlowValidatorImpl: fails for flow with invalid output.from", async () => {
  const dir = await setupTestDir();
  try {
    await Deno.writeTextFile(
      `${dir}/bad-output.flow.yaml`,
      yamlFlowContent({
        id: "bad-output",
        name: "Bad Output",
        description: "Bad output flow",
        output: `{ from: "nonexistent", format: "markdown" }`,
      }),
    );
    const loader = new FlowLoader(dir);
    const validator = new FlowValidatorImpl(loader, "unused-blueprints-path");
    const result = await validator.validateFlow("bad-output");
    assertEquals(result.valid, false);
    assertEquals(
      typeof result.error === "string" && (result.error ?? "").includes("output.from references non-existent step"),
      true,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
