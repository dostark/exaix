/**
 * @module FlowLoaderValidationTest
 * @path packages/flow/tests/flow_loader_validation_test.ts
 * @description Verifies FlowLoader validation for Phase 56 dynamic step tool permissions.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { FlowLoader } from "@exaix/flow";
import { join } from "@std/path";
import { FlowStepExecutionMode, ToolName } from "@exaix/core";
import { McpToolName } from "@exaix/mcp";

async function createTempFlowFile(content: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const tempDir = await Deno.makeTempDir({ prefix: "flow-loader-test-" });
  const filePath = join(tempDir, "test.flow.yaml");
  await Deno.writeTextFile(filePath, content);
  return {
    path: tempDir,
    cleanup: async () => {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

Deno.test("FlowLoader: rejects dynamic step with write tool in permitted_tools", async () => {
  const flowYaml = `
id: test
name: Test Flow
description: Test flow for validation
version: "1.0"
output:
  from: step
  format: markdown
steps:
  - id: dynamic-step
    name: Dynamic exploration
    agent_role: senior-coder
    execution_mode: dynamic
    permitted_tools:
      - read_file
      - write_file
      - list_directory
`;

  const { path: flowsDir, cleanup } = await createTempFlowFile(flowYaml);
  try {
    const loader = new FlowLoader(flowsDir);
    let error: Error | null = null;
    try {
      await loader.loadFlow("test");
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
    }

    // Should fail validation with write tool error
    assertStringIncludes(
      error?.message ?? "",
      ToolName.WRITE_FILE,
      "Error should mention the write tool",
    );
    assertStringIncludes(
      error?.message ?? "",
      "dynamic",
      "Error should mention dynamic mode",
    );
  } finally {
    await cleanup();
  }
});

// Agent-role-level permitted_tools validation requires IBlueprintLoader integration —
// not yet implemented; only step-level tool-kind validation runs today.

Deno.test("FlowLoader: skips agent-role validation (requires IBlueprintLoader)", () => {
  // Agent-role-level validation requires loading the agent role blueprint
  // and comparing step.permitted_tools against agent_role.permitted_tools.
  // This is deferred until FlowRunner integration (Task 4).
});

Deno.test("FlowLoader: accepts valid declared step", async () => {
  const flowYaml = `
id: test
name: Test Flow
description: Test flow for validation
version: "1.0"
output:
  from: step
  format: markdown
steps:
  - id: declared-step
    name: Write output
    agent_role: senior-coder
    execution_mode: declared
    tools:
      - write_file
`;

  const { path: flowsDir, cleanup } = await createTempFlowFile(flowYaml);
  try {
    const loader = new FlowLoader(flowsDir);
    const flow = await loader.loadFlow("test");

    assertEquals(flow.id, "test");
    assertEquals(flow.steps[0].execution_mode, FlowStepExecutionMode.DECLARED);
  } finally {
    await cleanup();
  }
});

Deno.test("FlowLoader: accepts valid dynamic step with read-only tools", async () => {
  const flowYaml = `
id: test
name: Test Flow
description: Test flow for validation
version: "1.0"
output:
  from: step
  format: markdown
steps:
  - id: dynamic-step
    name: Explore codebase
    agent_role: senior-coder
    execution_mode: dynamic
    permitted_tools:
      - read_file
      - list_directory
      - search_files
`;

  const { path: flowsDir, cleanup } = await createTempFlowFile(flowYaml);
  try {
    const loader = new FlowLoader(flowsDir);
    const flow = await loader.loadFlow("test");

    assertEquals(flow.id, "test");
    assertEquals(flow.steps[0].execution_mode, FlowStepExecutionMode.DYNAMIC);
    assertEquals(flow.steps[0].permitted_tools, [
      McpToolName.READ_FILE,
      McpToolName.LIST_DIRECTORY,
      McpToolName.SEARCH_FILES,
    ]);
  } finally {
    await cleanup();
  }
});

Deno.test("FlowLoader: accepts dynamic step with empty permitted_tools", async () => {
  const flowYaml = `
id: test
name: Test Flow
description: Test flow for validation
version: "1.0"
output:
  from: step
  format: markdown
steps:
  - id: dynamic-step
    name: Explore codebase
    agent_role: senior-coder
    execution_mode: dynamic
    permitted_tools: []
`;

  const { path: flowsDir, cleanup } = await createTempFlowFile(flowYaml);
  try {
    const loader = new FlowLoader(flowsDir);
    const flow = await loader.loadFlow("test");

    assertEquals(flow.id, "test");
    assertEquals(flow.steps[0].execution_mode, FlowStepExecutionMode.DYNAMIC);
    assertEquals(flow.steps[0].permitted_tools, []);
  } finally {
    await cleanup();
  }
});
