/**
 * @module ScenarioFrameworkScenarioSchema
 * @path tests/scenario_framework/schema/scenario_schema.ts
 * @description Defines the Step 1 top-level scenario schema for the
 * scenario framework.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/tests/unit/framework_contract_test.ts]
 */

import { z } from "zod";
import { BindingCatalogSchema, BindingFieldSchema, BindingsTableSchema, PinReasonSchema } from "@exaix/schemas";
import {
  PortalMountSchema,
  ScenarioExecutionMode,
  ScenarioSchemaVersionSchema,
  ScenarioStepSchema,
} from "./step_schema.ts";
import { MatrixSchema } from "../runner/matrix_expander.ts";
import { ScoringMode } from "../runner/scoring.ts";

/** A scenario pin. The runner computes each field's value at `selector` from the
 *  scenario and cell layers. It then refuses or strips any operator entry that
 *  would change that value. The `note` field is required, because a pin without
 *  a stated reason is an unexplained frozen value. */
export const ScenarioPinSchema = z.object({
  /** The selector whose values the pin protects. An operator entry at least as specific as
   *  this fails the run. A broader entry has the pinned fields stripped instead. */
  selector: z.string().min(1),
  /** The binding fields the pin protects. `effort` and `thinking` are not pinnable. */
  fields: z.array(
    BindingFieldSchema.exclude([
      BindingFieldSchema.enum.effort,
      BindingFieldSchema.enum.thinking,
    ]),
  ).min(1),
  reason: PinReasonSchema,
  note: z.string().min(1).max(200),
}).strict();

export type IScenarioPin = z.infer<typeof ScenarioPinSchema>;

/** The scenario's pins. Two pins may not share a selector, because each selector has one value per field. */
const ScenarioPinListSchema = z.array(ScenarioPinSchema).min(1).superRefine((pins, ctx) => {
  const seen = new Set<string>();
  for (const pin of pins) {
    if (seen.has(pin.selector)) {
      ctx.addIssue({ code: "custom", message: `two pins share the selector "${pin.selector}"` });
    }
    seen.add(pin.selector);
  }
});

const NON_EMPTY_STRING = z.string().min(1);

export const ScenarioSchema = z.object({
  schema_version: ScenarioSchemaVersionSchema,
  id: NON_EMPTY_STRING,
  title: NON_EMPTY_STRING,
  pack: NON_EMPTY_STRING,
  tags: z.array(z.string().min(1)),
  request_fixture: NON_EMPTY_STRING,
  /** Optional source files exposed to a persona-response judge, scoped to portal roots. */
  judge_context_files: z.array(z.object({ alias: NON_EMPTY_STRING, path: NON_EMPTY_STRING }).strict()).min(1)
    .optional(),
  /** Framework-relative path to a flow YAML the runner stages into the sandbox's
   *  `Blueprints/Flows/<flow-id>.flow.yaml` (named after the flow's own id, not this file's
   *  name) before steps run — see synthetic_runner.ts:stageFlowFixture. */
  flow_fixture: NON_EMPTY_STRING.optional(),
  /** Framework-relative path to the task's ground-truth reference patch (e.g.
   *  `fixtures/swe_tasks/<task>/reference.patch`), exposed to steps as `$REFERENCE_PATCH`.
   *  llm-judge passes it as `context_path` to grade the worktree diff against the reference. */
  reference_patch: NON_EMPTY_STRING.optional(),
  mode_support: z.array(z.nativeEnum(ScenarioExecutionMode)).min(1),
  portals: z.array(PortalMountSchema),
  steps: z.array(ScenarioStepSchema).min(1),
  /** Scenario-layer binding entries. The runner applies them per run.
   *  They sit above the flow and config layers, and below the cell, operator and step layers. */
  bindings: BindingsTableSchema.optional(),
  /** Scenario-layer catalog entries (services, models, preferences) merged per run. */
  catalog: BindingCatalogSchema.optional(),
  /** Bind the scenario's own values so an operator override fails loudly instead of
   *  silently changing what the scenario measures. Enforced by removal in the runner. */
  pin: ScenarioPinListSchema.optional(),
  /** Additive `tool × provider` matrix block. When present, the runner expands the scenario
   *  into one cell-run per cell (see runner/matrix_expander.ts). Absent → runs unchanged. */
  matrix: MatrixSchema.optional(),
  /** Opt-in scoring mode. `gated` zeroes the suite when any `class: security` criterion
   *  fails; absent (default) is additive and byte-identical to pre-gating scoring. */
  scoring: z.nativeEnum(ScoringMode).optional(),
  edition: z.enum(["solo", "team", "enterprise"]).optional(),
  description: z.string().min(1).optional(),
  risk: z.string().min(1).optional(),
  ci_profile: z.string().min(1).optional(),
  cleanup: z.array(z.string().min(1)).optional(),
  expected_artifacts: z.array(z.string().min(1)).optional(),
  metadata: z.object({
    owner: z.string().min(1).optional(),
    created_at: z.string().datetime().optional(),
  }).strict().optional(),
}).strict().superRefine((scenario, ctx) => {
  const portalAliases = new Set<string>();
  for (const [index, portal] of scenario.portals.entries()) {
    if (portalAliases.has(portal.alias)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate portal alias: ${portal.alias}`,
        path: ["portals", index, "alias"],
      });
      continue;
    }
    portalAliases.add(portal.alias);
  }

  const stepIds = new Set<string>();
  for (const [index, step] of scenario.steps.entries()) {
    if (stepIds.has(step.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate step id: ${step.id}`,
        path: ["steps", index, "id"],
      });
      continue;
    }
    stepIds.add(step.id);
  }
});

export type IScenario = z.infer<typeof ScenarioSchema>;
