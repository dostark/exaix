/**
 * @module TemplateMatrixTest
 * @path tests/scenario_framework/tests/unit/template_matrix_test.ts
 * @description Verifies renderSweTaskTemplate emits correct YAML:
 *   cell-type-restricted steps, short tool references, catalog compatibility.
 *   Phase 141 Step 1.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/scenario_templates.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { type ISweTaskTemplateOptions, renderSweTaskTemplate } from "../../runner/scenario_templates.ts";

Deno.test("[TemplateMatrix] emits CLI-delegate steps when cells have requires_bin", () => {
  const yaml = renderSweTaskTemplate(makeOpts({
    cells: [
      {
        tool: "claude-code",
        provider: "$CELL_PROVIDER",
        config: "configs/claude-cli-delegate-all.toml",
        requiresBin: "claude",
      },
    ],
  }));
  assert(yaml.includes("patch-blueprint-capability"), "CLI-delegate: patch-blueprint-capability must be present");
  assert(yaml.includes("assert-no-dynamic-tool-calls"), "CLI-delegate: assert-no-dynamic-tool-calls must be present");
  assert(!yaml.includes("assert-trajectory"), "CLI-delegate: assert-trajectory must be absent");
});

Deno.test("[TemplateMatrix] emits direct-API steps when cells have no requires_bin", () => {
  const yaml = renderSweTaskTemplate(makeOpts({
    cells: [
      {
        tool: "exactl",
        provider: "anthropic",
        config: "configs/anthropic-no-delegate.toml",
        requiresKey: "ANTHROPIC_API_KEY",
      },
    ],
  }));
  assert(yaml.includes("assert-trajectory"), "direct-API: assert-trajectory must be present");
  assert(!yaml.includes("patch-blueprint-capability"), "direct-API: patch-blueprint-capability must be absent");
  assert(!yaml.includes("assert-files-changed"), "direct-API: assert-files-changed must be absent");
});

Deno.test("[TemplateMatrix] YAML parses as valid scenario schema", () => {
  const yaml = renderSweTaskTemplate(makeOpts({
    cells: [
      {
        tool: "claude-code",
        provider: "$CELL_PROVIDER",
        config: "configs/claude-cli-delegate-all.toml",
        requiresBin: "claude",
      },
    ],
  }));
  const parsed = parseYaml(yaml) as IParsedScenarioYaml;
  assertEquals(typeof parsed.schema_version, "string");
  assertEquals(typeof parsed.id, "string");
  assertEquals(Array.isArray(parsed.steps), true);
});

Deno.test("[TemplateMatrix] emits scoring weights from options", () => {
  const yaml = renderSweTaskTemplate(makeOpts({
    cells: [{
      tool: "claude-code",
      provider: "$CELL_PROVIDER",
      config: "configs/claude-cli-delegate-all.toml",
      requiresBin: "claude",
    }],
    scoringWeights: { tests_pass: 0.25, llm_judge_quality: 0.35 },
  }));
  assert(yaml.includes("score_weight: 0.25"), "custom tests_pass weight");
  assert(yaml.includes("score_weight: 0.35"), "custom llm_judge_quality weight");
});

Deno.test("[TemplateMatrix] emits trajectory sequence from options", () => {
  const yaml = renderSweTaskTemplate(makeOpts({
    cells: [{
      tool: "exactl",
      provider: "anthropic",
      config: "configs/anthropic-no-delegate.toml",
      requiresKey: "ANTHROPIC_API_KEY",
    }],
    trajectorySequence: [{ tool: "read_file" }, { tool: "patch_file" }, { tool: "run_command" }],
  }));
  assert(yaml.includes('- tool: "read_file"'), "read_file in trajectory");
  assert(yaml.includes('- tool: "patch_file"'), "patch_file in trajectory");
  assert(yaml.includes('- tool: "run_command"'), "run_command in trajectory");
});

interface IParsedScenarioYaml {
  schema_version: string;
  id: string;
  steps: Array<unknown>;
}

function makeOpts(overrides: Partial<ISweTaskTemplateOptions>): ISweTaskTemplateOptions {
  return {
    id: "swe-test-task",
    title: "Test task",
    requestFixture: "fixtures/requests/swe_tasks/test-task.md",
    cells: [
      {
        tool: "claude-code",
        provider: "$CELL_PROVIDER",
        config: "configs/claude-cli-delegate-all.toml",
        requiresBin: "claude",
      },
    ],
    ...overrides,
  };
}
