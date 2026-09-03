/**
 * @module TaskTypeDerivationTest
 * @path packages/execution/tests/task_type_derivation_test.ts
 * @description Phase 135 Step 8 (§5.8.8) — deriveTaskType precedence chain: request
 *   frontmatter > identity blueprint declaration > highest-confidence skill trigger >
 *   static task_type_map soft-match > analyzer-derived intent > UNKNOWN. Never shadows
 *   an entity's own declaration (anti-drift).
 * @architectural-layer Execution
 */
import { assertEquals } from "@std/assert";
import { TaskType } from "@exaix/core/types";
import { deriveTaskType } from "../src/task_type_derivation.ts";
import type { ITaskTypeDerivationContext } from "../src/task_type_derivation.ts";

Deno.test("[step135.8] frontmatter task_type wins over every other source", () => {
  const ctx: ITaskTypeDerivationContext = {
    frontmatterTaskType: TaskType.BUGFIX,
    agentRoleTaskType: TaskType.FEATURE,
    topSkillTaskTypes: [TaskType.TEST],
    agentRole: "senior-coder",
    taskTypeMap: { "senior-coder": TaskType.REFACTOR },
    analyzerTaskType: TaskType.DOCS,
  };
  const result = deriveTaskType(ctx);
  assertEquals(result.taskType, TaskType.BUGFIX);
  assertEquals(result.source, "frontmatter");
});

Deno.test("[step135.8] agent role blueprint declaration wins over skill/static-map/analyzer", () => {
  const ctx: ITaskTypeDerivationContext = {
    agentRoleTaskType: TaskType.FEATURE,
    topSkillTaskTypes: [TaskType.TEST],
    agentRole: "senior-coder",
    taskTypeMap: { "senior-coder": TaskType.REFACTOR },
    analyzerTaskType: TaskType.DOCS,
  };
  const result = deriveTaskType(ctx);
  assertEquals(result.taskType, TaskType.FEATURE);
  assertEquals(result.source, "agent_role");
});

Deno.test("[step135.8] highest-confidence skill trigger wins over static-map/analyzer", () => {
  const ctx: ITaskTypeDerivationContext = {
    topSkillTaskTypes: [TaskType.TEST],
    agentRole: "senior-coder",
    taskTypeMap: { "senior-coder": TaskType.REFACTOR },
    analyzerTaskType: TaskType.DOCS,
  };
  const result = deriveTaskType(ctx);
  assertEquals(result.taskType, TaskType.TEST);
  assertEquals(result.source, "skill");
});

Deno.test("[step135.8] static task_type_map soft-matches senior-coder-v2 → senior-coder; wins over analyzer", () => {
  const ctx: ITaskTypeDerivationContext = {
    agentRole: "senior-coder-v2",
    taskTypeMap: { "senior-coder": TaskType.REFACTOR },
    analyzerTaskType: TaskType.DOCS,
  };
  const result = deriveTaskType(ctx);
  assertEquals(result.taskType, TaskType.REFACTOR);
  assertEquals(result.source, "static_map");
});

Deno.test("[step135.8] unmatched static map identity falls through to analyzer", () => {
  const ctx: ITaskTypeDerivationContext = {
    agentRole: "totally-unrelated-name",
    taskTypeMap: { "senior-coder": TaskType.REFACTOR },
    analyzerTaskType: TaskType.DOCS,
  };
  const result = deriveTaskType(ctx);
  assertEquals(result.taskType, TaskType.DOCS);
  assertEquals(result.source, "analyzer");
});

Deno.test("[step135.8] no source matches at all → UNKNOWN", () => {
  const ctx: ITaskTypeDerivationContext = {};
  const result = deriveTaskType(ctx);
  assertEquals(result.taskType, TaskType.UNKNOWN);
  assertEquals(result.source, "unknown");
});

Deno.test("[step135.8][edge] static map exact match takes priority over normalised-prefix match", () => {
  const ctx: ITaskTypeDerivationContext = {
    agentRole: "senior-coder",
    taskTypeMap: {
      "senior-coder": TaskType.FEATURE,
      "senior": TaskType.BUGFIX,
    },
  };
  const result = deriveTaskType(ctx);
  assertEquals(result.taskType, TaskType.FEATURE);
  assertEquals(result.source, "static_map");
});

Deno.test("[step135.8][edge] static map normalised-prefix match: senior-coder-v3 falls back to senior-coder prefix entry", () => {
  const ctx: ITaskTypeDerivationContext = {
    agentRole: "senior-coder-v3",
    taskTypeMap: { "senior-coder": TaskType.REFACTOR },
  };
  const result = deriveTaskType(ctx);
  assertEquals(result.taskType, TaskType.REFACTOR);
  assertEquals(result.source, "static_map");
});

Deno.test("[step135.8] identity declaration never shadowed by a static_map entry for the same identity (anti-drift)", () => {
  const ctx: ITaskTypeDerivationContext = {
    agentRole: "senior-coder",
    agentRoleTaskType: TaskType.FEATURE,
    taskTypeMap: { "senior-coder": TaskType.REFACTOR },
  };
  const result = deriveTaskType(ctx);
  assertEquals(result.taskType, TaskType.FEATURE);
  assertEquals(result.source, "agent_role");
});

Deno.test("[step135.8] topSkillTaskTypes takes the first (highest-confidence) entry only", () => {
  const ctx: ITaskTypeDerivationContext = {
    topSkillTaskTypes: [TaskType.SECURITY, TaskType.TEST],
  };
  const result = deriveTaskType(ctx);
  assertEquals(result.taskType, TaskType.SECURITY);
  assertEquals(result.source, "skill");
});
