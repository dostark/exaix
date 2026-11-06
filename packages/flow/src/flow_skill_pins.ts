/**
 * @module FlowSkillPins
 * @path packages/flow/src/flow_skill_pins.ts
 * @description Resolves declared flow skills and role defaults into durable, budget-fitted execution pins.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/agent_composer_adapter.ts, packages/execution/src/skill_pin_transport.ts]
 */
import { isAbsolute, join } from "@std/path";
import { IBlueprintLoader, type ILoadedBlueprint } from "@exaix/core/blueprint";
import { SKILL_EVENT_RESOLVED, SkillMatchSource, SkillRenderOutcome, SkillRootKind } from "@exaix/core";
import {
  buildSkillPin,
  createSkillOperationContext,
  type ISkillOperationContext,
  type ISkillPin,
  orderSkillPins,
  skillToContextEntry,
  SkillUnavailableError,
} from "@exaix/core/skills";
import type { ISkillsService } from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import { createPinnedSkillPrompt, EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR } from "@exaix/execution";
import type { Config } from "@exaix/schemas/config.ts";
import type { IFlowStepRequest } from "./flow_types.ts";

interface IFlowSkillInput {
  skills: ISkillsService;
  config: Config;
  logger: IEventLogger;
  blueprint: ILoadedBlueprint;
  request: IFlowStepRequest;
  traceId: string;
}

/** Verifies that both role loaders refer to the same configured file. */
async function checkRoleRoot(input: IFlowSkillInput): Promise<void> {
  const base = isAbsolute(input.config.paths.blueprints)
    ? input.config.paths.blueprints
    : join(input.config.system.root, input.config.paths.blueprints);
  const configured = await new IBlueprintLoader({ blueprintsPath: base }).load(input.blueprint.agentRole);
  if (!configured || await Deno.realPath(configured.path) !== await Deno.realPath(input.blueprint.path)) {
    throw new Error("Flow and composer blueprint roots disagree");
  }
}

/** Returns pins and the same operation context used for their later submission. */
export async function prepareFlowSkillPins(
  input: IFlowSkillInput,
): Promise<{ pins: ISkillPin[]; operation: ISkillOperationContext }> {
  await checkRoleRoot(input);
  const { request, blueprint, skills, config } = input;
  const operation = createSkillOperationContext({
    agentRole: blueprint.agentRole,
    portal: request.portal,
    traceId: input.traceId,
    requestId: request.requestId,
    flowId: request.flowId,
    flowStepId: request.flowStepId,
    configGeneration: skills.currentConfigGeneration(),
  });
  const pinned = request.skills ?? [];
  const defaults = blueprint.frontmatter.default_skills ?? [];
  const declared = [...new Set([...pinned, ...defaults])];
  const suppressed = new Set(
    (Deno.env.get(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR) ?? "")
      .split(",").map((id) => id.trim()).filter(Boolean),
  );
  const names = declared.filter((name) => !suppressed.has(name));
  const entries = [];
  for (const name of names) {
    const skill = await skills.getSkill(name, operation);
    if (!skill) throw new SkillUnavailableError(name);
    entries.push(skillToContextEntry(skill, {
      confidence: pinned.includes(name) ? 1.0 : 0.5,
      source: pinned.includes(name) ? SkillMatchSource.PINNED : SkillMatchSource.DEFAULT,
      matchedTriggers: {},
    }));
  }
  const candidates = orderSkillPins(entries.map((entry) =>
    buildSkillPin(entry, {
      portal: entry.rootKind === SkillRootKind.PROJECT ? operation.portal : null,
      renderMode: entry.critical ? SkillRenderOutcome.CRITICAL : SkillRenderOutcome.FULL,
      contentIncluded: true,
    })
  ));
  await skills.ensureRevisions(candidates.map((pin) => pin.revision_id), operation);
  const probe = await createPinnedSkillPrompt(skills, candidates, operation);
  const included = new Set(probe?.fit(config.skills.context_budget_chars).includedNames ?? []);
  for (const entry of entries) {
    if ((entry.critical || entry.source === SkillMatchSource.PINNED) && !included.has(entry.skillId)) {
      throw new SkillUnavailableError(entry.skillId, `Required skill ${entry.skillId} does not fit the prompt budget`);
    }
  }
  const pins = candidates.map((pin) => ({ ...pin, content_included: included.has(pin.name) }));
  await input.logger.info(SKILL_EVENT_RESOLVED, blueprint.agentRole, {
    agent_role: blueprint.agentRole,
    skill_ids: names,
    skill_count: names.length,
    pinned_skill_ids: pinned,
    matched_skill_ids: [],
    default_skill_ids: defaults,
    suppressed_skill_ids: declared.filter((name) => suppressed.has(name)),
  }, input.traceId);
  return { pins, operation };
}
