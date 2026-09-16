/**
 * @module PersonaIsolationArm
 * @path tests/scenario_framework/runner/persona_isolation_arm.ts
 * @description Builds persona-isolation cells, materializes body-only agent-role overlays,
 * and validates paired comparison provenance for Phase 161.
 * @architectural-layer Test
 * @dependencies [tests/scenario_framework/runner/arm_comparison.ts, tests/scenario_framework/runner/arm_overlay.ts, packages/portal/src/path_resolver.ts]
 * @related-files [scripts/run_persona_isolation.ts, tests/scenario_framework/tests/unit/persona_isolation_arm_test.ts]
 */

import { basename, join, relative } from "@std/path";
import type { PathResolver } from "@exaix/portal";
import type { Opt, Reason } from "@exaix/core/types";
import { ArmKind, ComparisonMetric, type IArmComparisonSpec, type IComparisonInput } from "./arm_comparison.ts";
import { validateCatalogOverlayDir } from "./arm_overlay.ts";

export type PersonaVariant = typeof PERSONA_VARIANTS[number];
type PersonaControlVariant = typeof PERSONA_CONTROL_VARIANTS[number];

export interface IPersonaIsolationArmInput {
  agentRoleId: string;
  scenarioIds: string[];
  trials: number;
  provider: string;
  model: string;
  sourceBlueprintAlias: string;
  overlayRootAlias: string;
}

export interface IPersonaIsolationCell {
  variant: PersonaVariant;
  scenarioIds: string[];
  trials: number;
  provider: string;
  model: string;
  overlayDir: string;
}

export interface IPersonaIsolationArmPlan {
  armId: string;
  agentRoleId: string;
  scenarioIds: string[];
  trials: number;
  provider: string;
  model: string;
  sourceBlueprintPath: string;
  overlayRoot: string;
  cells: IPersonaIsolationCell[];
  comparisons: IArmComparisonSpec[];
}

export interface IMaterializedPersonaVariant {
  variant: PersonaVariant;
  overlayDir: string;
  blueprintPath: string;
}

export interface IPersonaTaskRunResult {
  taskId: string;
  scores: number[];
  runManifestIds: string[];
}

export interface IPersonaIsolationRunResult {
  variant: PersonaVariant;
  provider: string;
  model: string;
  tasks: IPersonaTaskRunResult[];
}

export interface IPersonaComparisonRequest {
  input: IComparisonInput;
}

export interface IPersonaComparisonInput {
  armComparisons: IPersonaComparisonRequest[];
  basisRunIds: string[];
}

export interface IMaterializePersonaOptions {
  candidateContents?: Opt<Partial<Record<PersonaVariant, string>>, Reason.OptionalInput>;
}

export const PERSONA_VARIANTS = ["shipped", "generic", "empty"] as const;
export const GENERIC_PERSONA_BODY =
  "You are a helpful assistant. Follow your skills for methodology and output format.";

const PERSONA_CONTROL_VARIANTS = ["generic", "empty"] as const;
const MIN_PERSONA_TASKS = 2;
const MIN_PERSONA_TRIALS = 3;
const AGENT_ROLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SWE_SCENARIO_PREFIX = "swe-";
const FRONTMATTER_DELIMITER = "---";

/** Validates operator inputs and resolves all paths before any overlay is written or exported. */
export async function buildPersonaIsolationArmPlan(
  input: IPersonaIsolationArmInput,
  pathResolver: PathResolver,
): Promise<IPersonaIsolationArmPlan> {
  validateInput(input);
  if (input.sourceBlueprintAlias !== `@Blueprints/Agents/${input.agentRoleId}.md`) {
    throw new Error("Source blueprint alias must name the shipped agent role");
  }
  const sourceBlueprintPath = await pathResolver.resolve(input.sourceBlueprintAlias);
  if (basename(sourceBlueprintPath) !== `${input.agentRoleId}.md`) {
    throw new Error("Source blueprint does not match the requested agent role");
  }
  const overlayRoot = await validateCatalogOverlayDir(pathResolver, input.overlayRootAlias);
  const cells = PERSONA_VARIANTS.map((variant) => ({
    variant,
    scenarioIds: [...input.scenarioIds],
    trials: input.trials,
    provider: input.provider,
    model: input.model,
    overlayDir: join(overlayRoot, input.agentRoleId, variant),
  }));
  const registeredAt = new Date().toISOString();
  const comparisons = [
    comparisonSpec(input, "shipped-vs-generic", "generic", registeredAt),
    comparisonSpec(input, "shipped-vs-empty", "empty", registeredAt),
  ];
  return {
    armId: `persona-isolation-${input.agentRoleId}`,
    agentRoleId: input.agentRoleId,
    scenarioIds: [...input.scenarioIds],
    trials: input.trials,
    provider: input.provider,
    model: input.model,
    sourceBlueprintPath,
    overlayRoot,
    cells,
    comparisons,
  };
}

/** Writes complete role files whose frontmatter is identical and whose body is the arm variable. */
export async function materializePersonaVariants(
  plan: IPersonaIsolationArmPlan,
  options: IMaterializePersonaOptions = {},
): Promise<IMaterializedPersonaVariant[]> {
  const shippedContent = await Deno.readTextFile(plan.sourceBlueprintPath);
  const { frontmatter, body } = splitBlueprint(shippedContent);
  const bodies: Record<PersonaVariant, string> = {
    shipped: body,
    generic: `\n\n${GENERIC_PERSONA_BODY}\n`,
    empty: "\n",
  };

  const materialized: IMaterializedPersonaVariant[] = [];
  for (const cell of plan.cells) {
    assertContained(plan.overlayRoot, cell.overlayDir);
    const candidate = options.candidateContents?.[cell.variant];
    if (candidate !== undefined && splitBlueprint(candidate).frontmatter !== frontmatter) {
      throw new Error("Persona variant changed immutable blueprint frontmatter");
    }
    const content = candidate ?? `${frontmatter}${bodies[cell.variant]}`;
    const blueprintPath = join(cell.overlayDir, `${plan.agentRoleId}.md`);
    assertContained(plan.overlayRoot, blueprintPath);
    await Deno.mkdir(cell.overlayDir, { recursive: true });
    await Deno.writeTextFile(blueprintPath, content);
    materialized.push({ variant: cell.variant, overlayDir: cell.overlayDir, blueprintPath });
  }
  return materialized;
}

/** Converts validated cell results into the shared value-report input contract. */
export function buildPersonaComparisonInput(
  plan: IPersonaIsolationArmPlan,
  results: IPersonaIsolationRunResult[],
): IPersonaComparisonInput {
  const byVariant = new Map(results.map((result) => [result.variant, result]));
  if (byVariant.size !== PERSONA_VARIANTS.length) {
    throw new Error("Persona comparison requires one result for every variant");
  }
  for (const variant of PERSONA_VARIANTS) {
    validateRunResult(plan, byVariant.get(variant));
  }
  const shipped = byVariant.get("shipped")!;
  const armComparisons = PERSONA_CONTROL_VARIANTS.map((controlVariant) => ({
    input: {
      armId: `${plan.armId}-shipped-vs-${controlVariant}`,
      metric: ComparisonMetric.JUDGE_SCORE,
      tasks: plan.scenarioIds.map((taskId) => ({
        taskId,
        control: findTask(byVariant.get(controlVariant)!, taskId).scores,
        treatment: findTask(shipped, taskId).scores,
      })),
    },
  }));
  return {
    armComparisons,
    basisRunIds: results.flatMap((result) => result.tasks.flatMap((task) => task.runManifestIds)),
  };
}

function validateInput(input: IPersonaIsolationArmInput): void {
  if (!AGENT_ROLE_ID_PATTERN.test(input.agentRoleId)) throw new Error("Invalid agent role id");
  if (!input.provider.trim() || !input.model.trim()) throw new Error("Provider and model pins are required");
  if (input.scenarioIds.length < MIN_PERSONA_TASKS) throw new Error("At least two SWE scenarios are required");
  if (new Set(input.scenarioIds).size !== input.scenarioIds.length) throw new Error("Scenario ids must be unique");
  if (input.scenarioIds.some((id) => !id.startsWith(SWE_SCENARIO_PREFIX))) {
    throw new Error("Persona isolation accepts only SWE task scenario ids");
  }
  if (!Number.isInteger(input.trials) || input.trials < MIN_PERSONA_TRIALS) {
    throw new Error("Persona isolation requires at least three trials");
  }
}

function comparisonSpec(
  input: IPersonaIsolationArmInput,
  suffix: string,
  control: PersonaControlVariant,
  registeredAt: string,
): IArmComparisonSpec {
  return {
    armId: `persona-isolation-${input.agentRoleId}-${suffix}`,
    kind: ArmKind.AGENT_ROLE_PERSONA_ISOLATION,
    control: { description: `${control} persona` },
    treatment: { description: "shipped persona" },
    taskIds: [...input.scenarioIds],
    trials: input.trials,
    metric: ComparisonMetric.JUDGE_SCORE,
    registeredAt,
  };
}

function splitBlueprint(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith(`${FRONTMATTER_DELIMITER}\n`)) throw new Error("Blueprint frontmatter is required");
  const closingIndex = content.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length);
  if (closingIndex < 0) throw new Error("Blueprint frontmatter is malformed");
  const bodyStart = closingIndex + FRONTMATTER_DELIMITER.length + 1;
  return { frontmatter: content.slice(0, bodyStart), body: content.slice(bodyStart) };
}

function assertContained(root: string, target: string): void {
  const relation = relative(root, target);
  if (relation === ".." || relation.startsWith(`..${String.raw`/`}`) || relation.startsWith("/")) {
    throw new Error("Access denied: persona overlay path is outside the validated root");
  }
}

function validateRunResult(
  plan: IPersonaIsolationArmPlan,
  result: Opt<IPersonaIsolationRunResult, Reason.ShapeValidation>,
): void {
  if (!result) throw new Error("Missing persona variant result");
  if (result.provider !== plan.provider || result.model !== plan.model) {
    throw new Error("Persona result provider/model provenance does not match the plan");
  }
  if (result.tasks.length !== plan.scenarioIds.length) throw new Error("Persona result task set is incomplete");
  for (const taskId of plan.scenarioIds) {
    const task = findTask(result, taskId);
    if (task.scores.length !== plan.trials || task.runManifestIds.length === 0) {
      throw new Error("Persona result arrays are not aligned to the preregistered trial count");
    }
  }
}

function findTask(result: IPersonaIsolationRunResult, taskId: string): IPersonaTaskRunResult {
  const matches = result.tasks.filter((task) => task.taskId === taskId);
  if (matches.length !== 1) throw new Error("Persona result tasks are missing or duplicated");
  return matches[0];
}
