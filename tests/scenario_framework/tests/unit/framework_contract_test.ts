/**
 * @module ScenarioFrameworkContractTest
 * @path tests/scenario_framework/tests/unit/framework_contract_test.ts
 * @description RED-first contract tests for Step 1. Verifies the
 * initial scenario schema, criterion taxonomy, CI profile resolution, runtime
 * configuration validation, and portal lifecycle planner behavior before any
 * runner implementation is added.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts, tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/runner/config.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  planPortalMount,
  PortalLifecycleAction,
  resolveScenarioSelection,
  RuntimeConfigSchema,
  ScenarioCiProfile,
  ScenarioSelectionSource,
} from "../../runner/config.ts";
import { ScenarioSchema } from "../../schema/scenario_schema.ts";
import { SCHEMA_VERSION } from "../../schema/version.ts";
import { CriterionResultSchema, CriterionStatus } from "../../schema/step_schema.ts";

Deno.test("[ScenarioFrameworkContract] accepts a valid scenario document", () => {
  const result = ScenarioSchema.parse({
    schema_version: SCHEMA_VERSION,
    id: "memory-aware-analysis",
    title: "memory-aware analysis enriches request understanding",
    pack: "agent_flows",
    tags: ["analysis", "smoke"],
    request_fixture: "fixtures/requests/agent_flows/memory_aware_analysis.md",
    mode_support: ["auto", "step", "manual-checkpoint"],
    portals: [
      {
        alias: "portal-exaix",
        source_path: "/tmp/exaix",
      },
      {
        alias: "portal-sample-app",
        source_path: "/tmp/sample-app",
      },
    ],
    steps: [
      {
        id: "create-request",
        type: "exactl",
        command: "request",
        args: ["--file", "fixtures/requests/agent_flows/memory_aware_analysis.md"],
        input_criteria: [
          {
            id: "request-fixture-exists",
            kind: "file-exists",
            path: "fixtures/requests/agent_flows/memory_aware_analysis.md",
          },
          {
            id: "portal-available",
            kind: "portal-mounted",
            alias: "portal-exaix",
          },
        ],
        output_criteria: [
          {
            id: "request-created",
            kind: "command-exit-code",
            equals: 0,
          },
        ],
      },
    ],
  });

  assertEquals(result.portals.length, 2);
  assertEquals(result.steps[0].output_criteria[0].kind, "command-exit-code");
});

Deno.test("[ScenarioFrameworkContract] accepts a scenario with extended fields (flow_fixture, boolean checkpoint, expect_failure, unique_count_min)", () => {
  const result = ScenarioSchema.parse({
    schema_version: SCHEMA_VERSION,
    id: "extended-fields-test",
    title: "Extended fields test",
    pack: "framework_test",
    tags: ["test"],
    request_fixture: "fixtures/requests/shared/request.md",
    flow_fixture: "fixtures/flows/shared/test.flow.yaml",
    mode_support: ["auto"],
    portals: [],
    steps: [
      {
        id: "step-1",
        type: "shell",
        command: "echo ok",
        checkpoint: true,
        expect_failure: true,
        input_criteria: [],
        output_criteria: [
          {
            id: "unique-items",
            kind: "json-query",
            query: "items",
            unique_count_min: 5,
          },
          {
            id: "output-contains",
            kind: "command-output-contains",
            contains: ["success", "completed"],
          },
        ],
      },
    ],
  });

  assertEquals(result.flow_fixture, "fixtures/flows/shared/test.flow.yaml");
  assertEquals(result.steps[0].checkpoint, true);
  assertEquals(result.steps[0].expect_failure, true);
  const jsonQueryCriterion = result.steps[0].output_criteria[0] as Record<string, unknown>;
  assertEquals(jsonQueryCriterion.unique_count_min, 5);
  const commandOutputCriterion = result.steps[0].output_criteria[1] as Record<string, unknown>;
  assertEquals(commandOutputCriterion.kind, "command-output-contains");
  assertEquals(commandOutputCriterion.contains, ["success", "completed"]);
});

Deno.test("[ScenarioFrameworkContract] rejects scenarios missing required metadata", () => {
  assertThrows(
    () => {
      ScenarioSchema.parse({
        pack: "agent_flows",
        tags: ["smoke"],
        request_fixture: "fixtures/requests/shared/request.md",
        mode_support: ["auto"],
        portals: [],
        steps: [],
      });
    },
    Error,
    "title",
  );
});

Deno.test("[ScenarioFrameworkContract] rejects steps missing criterion ids or kinds", () => {
  assertThrows(
    () => {
      ScenarioSchema.parse({
        schema_version: SCHEMA_VERSION,
        id: "missing-criterion-id",
        title: "Missing criterion ids",
        pack: "smoke",
        tags: ["smoke"],
        request_fixture: "fixtures/requests/shared/request.md",
        mode_support: ["auto"],
        portals: [],
        steps: [
          {
            id: "step-1",
            type: "shell",
            input_criteria: [{ kind: "file-exists", path: "foo.txt" }],
            output_criteria: [],
          },
        ],
      });
    },
    Error,
    "id",
  );
});

Deno.test("[ScenarioFrameworkContract] rejects duplicate portal aliases", () => {
  assertThrows(
    () => {
      ScenarioSchema.parse({
        schema_version: SCHEMA_VERSION,
        id: "duplicate-portals",
        title: "Duplicate portals",
        pack: "smoke",
        tags: ["smoke"],
        request_fixture: "fixtures/requests/shared/request.md",
        mode_support: ["auto"],
        portals: [
          { alias: "portal-app", source_path: "/tmp/a" },
          { alias: "portal-app", source_path: "/tmp/b" },
        ],
        steps: [
          {
            id: "step-1",
            type: "shell",
            command: "echo ok",
            input_criteria: [],
            output_criteria: [],
          },
        ],
      });
    },
    Error,
    "duplicate",
  );
});

Deno.test("[ScenarioFrameworkContract] rejects unsupported criterion kinds", () => {
  assertThrows(
    () => {
      ScenarioSchema.parse({
        schema_version: SCHEMA_VERSION,
        id: "unsupported-criterion-kind",
        title: "Unsupported criterion kind",
        pack: "smoke",
        tags: ["smoke"],
        request_fixture: "fixtures/requests/shared/request.md",
        mode_support: ["auto"],
        portals: [],
        steps: [
          {
            id: "step-1",
            type: "shell",
            input_criteria: [
              {
                id: "criterion-1",
                kind: "made-up-kind",
              },
            ],
            output_criteria: [],
          },
        ],
      });
    },
    Error,
    "Invalid discriminator value",
  );
});

Deno.test("[ScenarioFrameworkContract] rejects invalid criterion result status payloads", () => {
  assertThrows(
    () => {
      CriterionResultSchema.parse({
        criterion_id: "criterion-1",
        kind: "file-exists",
        phase: "input",
        status: "not-a-real-status",
        message: "bad status",
        evidence_refs: [],
      });
    },
    Error,
    "Invalid enum value",
  );

  assertEquals(CriterionStatus.PASSED, "passed");
});

Deno.test("[ScenarioFrameworkContract] CI profile selection obeys explicit precedence rules", () => {
  const selection = resolveScenarioSelection({
    explicitScenarioIds: ["scenario-a"],
    explicitPacks: ["agent_flows"],
    explicitTags: ["smoke"],
    profile: ScenarioCiProfile.CORE,
  });

  assertEquals(selection.source, ScenarioSelectionSource.EXPLICIT_SCENARIO_IDS);
  assertEquals(selection.scenarioIds, ["scenario-a"]);
  assertEquals(selection.packs, []);
  assertEquals(selection.tags, []);
});

Deno.test("[ScenarioFrameworkContract] runtime config schema rejects missing required fields", () => {
  assertThrows(
    () => {
      RuntimeConfigSchema.parse({
        mode: "auto",
      });
    },
    Error,
    "workspace_path",
  );
});

Deno.test("[ScenarioFrameworkContract] portal lifecycle planner rejects destructive remount without override", () => {
  const error = assertThrows(
    () => {
      planPortalMount({
        alias: "portal-app",
        desiredSourcePath: "/tmp/new-path",
        existingMount: {
          alias: "portal-app",
          sourcePath: "/tmp/current-path",
          ownership: "framework",
        },
        allowDestructiveRemount: false,
      });
    },
    Error,
  );

  assertStringIncludes(error.message, "destructive remount");
});

Deno.test("[ScenarioFrameworkContract] portal lifecycle planner reuses exact matching mounts", () => {
  const plan = planPortalMount({
    alias: "portal-app",
    desiredSourcePath: "/tmp/current-path",
    existingMount: {
      alias: "portal-app",
      sourcePath: "/tmp/current-path",
      ownership: "user",
    },
    allowDestructiveRemount: false,
  });

  assertEquals(plan.action, PortalLifecycleAction.REUSE_EXISTING);
  assertEquals(plan.frameworkOwned, false);
});
