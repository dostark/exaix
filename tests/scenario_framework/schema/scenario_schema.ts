/**
 * @module ScenarioFrameworkScenarioSchema
 * @path tests/scenario_framework/schema/scenario_schema.ts
 * @description Defines the Step 1 top-level scenario schema for the
 * scenario framework.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/step_schema.ts, tests/scenario_framework/tests/unit/framework_contract_test.ts]
 */

import { z } from "zod";
import {
  PortalMountSchema,
  ScenarioExecutionMode,
  ScenarioSchemaVersionSchema,
  ScenarioStepSchema,
} from "./step_schema.ts";
import { MatrixSchema } from "../runner/matrix_expander.ts";
import { ScoringMode } from "../runner/scoring.ts";

const NON_EMPTY_STRING = z.string().min(1);

export const ScenarioSchema = z.object({
  schema_version: ScenarioSchemaVersionSchema,
  id: NON_EMPTY_STRING,
  title: NON_EMPTY_STRING,
  pack: NON_EMPTY_STRING,
  tags: z.array(z.string().min(1)),
  request_fixture: NON_EMPTY_STRING,
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
