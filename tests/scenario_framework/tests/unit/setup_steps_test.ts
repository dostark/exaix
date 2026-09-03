/**
 * @module ScenarioFrameworkSetupStepsTest
 * @path tests/scenario_framework/tests/unit/setup_steps_test.ts
 * @description Tests for the sandbox-setup step types that replaced shell setup:
 *   patch-blueprint (add capabilities to a sandboxed blueprint's frontmatter) and
 *   prepare-evidence (copy a cwd-relative source to a workspace evidence target).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_executor.ts, tests/scenario_framework/schema/step_schema.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { executeScenarioStep } from "../../runner/step_executor.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";

async function withWorkspace(fn: (ws: string) => Promise<void>): Promise<void> {
  const ws = await Deno.makeTempDir({ prefix: "setup-steps-" });
  try {
    await fn(ws);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
}

Deno.test("[setup_steps] patch-blueprint adds a capability to the sandboxed blueprint", async () => {
  await withWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "Blueprints", "Agents"), { recursive: true });
    await Deno.writeTextFile(
      join(ws, "Blueprints", "Agents", "senior-coder.md"),
      '---\nagent_role: "senior-coder"\ncapabilities: ["react"]\n---\n',
    );
    const result = await executeScenarioStep({
      step: {
        id: "patch-blueprint-capability",
        type: ScenarioStepType.PATCH_BLUEPRINT,
        blueprint: "senior-coder",
        add_capabilities: ["cli_delegate"],
        input_criteria: [],
        output_criteria: [],
        continue_on_failure: false,
      } as never,
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected patch to succeed, got: ${result.stderr}`);
    const updated = await Deno.readTextFile(join(ws, "Blueprints", "Agents", "senior-coder.md"));
    assertEquals(updated.includes('"cli_delegate"'), true, "capability must be added");
  });
});

Deno.test("[setup_steps] patch-blueprint is idempotent (does not duplicate an existing capability)", async () => {
  await withWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "Blueprints", "Agents"), { recursive: true });
    await Deno.writeTextFile(
      join(ws, "Blueprints", "Agents", "senior-coder.md"),
      '---\ncapabilities: ["react", "cli_delegate"]\n---\n',
    );
    await executeScenarioStep({
      step: {
        id: "patch-blueprint-capability",
        type: ScenarioStepType.PATCH_BLUEPRINT,
        blueprint: "senior-coder",
        add_capabilities: ["cli_delegate"],
        input_criteria: [],
        output_criteria: [],
        continue_on_failure: false,
      } as never,
      cwd: ws,
    });
    const updated = await Deno.readTextFile(join(ws, "Blueprints", "Agents", "senior-coder.md"));
    const count = updated.match(/"cli_delegate"/g)?.length ?? 0;
    assertEquals(count, 1, "capability must not be duplicated");
  });
});

Deno.test("[setup_steps] prepare-evidence copies a cwd-relative source to the workspace target", async () => {
  await withWorkspace(async (ws) => {
    await Deno.mkdir(join(ws, "todo-app", "src"), { recursive: true });
    await Deno.writeTextFile(join(ws, "todo-app", "src", "business_logic.ts"), "export const x = 1;\n");
    const result = await executeScenarioStep({
      step: {
        id: "prepare-llm-judge-evidence",
        type: ScenarioStepType.PREPARE_EVIDENCE,
        cwd: "todo-app",
        source: "src/business_logic.ts",
        target: "llm-judge-input.txt",
        input_criteria: [],
        output_criteria: [],
        continue_on_failure: false,
      } as never,
      cwd: ws,
    });
    assertEquals(result.exitCode, 0, `expected evidence copy, got: ${result.stderr}`);
    const content = await Deno.readTextFile(join(ws, "llm-judge-input.txt"));
    assertEquals(content.includes("export const x = 1"), true, "evidence must contain the source content");
  });
});
