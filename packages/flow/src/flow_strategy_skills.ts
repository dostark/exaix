/**
 * @module FlowStrategySkills
 * @path packages/flow/src/flow_strategy_skills.ts
 * @description Prepares declared skills and execution options for one flow strategy step.
 * @architectural-layer Flows
 * @dependencies ["@exaix/execution", "@exaix/core", "@exaix/schemas"]
 * @related-files ["packages/flow/src/agent_composer_adapter.ts", "packages/flow/src/flow_skill_pins.ts"]
 */

import { ExecutionStrategyName } from "@exaix/core";
import type { IBlueprintLoader } from "@exaix/core/blueprint";
import type { IEventLogger } from "@exaix/core/logger";
import type { ISkillOperationContext, ISkillPin } from "@exaix/core/skills";
import type { ISkillsService, Opt, Reason } from "@exaix/core/types";
import type { Config } from "@exaix/schemas/config.ts";
import type { IAgentExecutionOptionsInput } from "@exaix/schemas/agent_composer.ts";
import { prepareFlowSkillPins } from "./flow_skill_pins.ts";
import type { IFlowStepRequest } from "./flow_types.ts";

/** The collaborators a strategy step needs to prepare its declared skills. */
export interface IStrategySkillSource {
  loader: IBlueprintLoader;
  skillsService?: Opt<ISkillsService, Reason.OptionalDependency>;
  config: Config;
  logger: IEventLogger;
}

/** Prepares declared skills only on the injected CLI transport path. */
export async function prepareStrategySkills(
  source: IStrategySkillSource,
  agentRole: string,
  request: IFlowStepRequest,
  traceId: string,
  strategy: ExecutionStrategyName,
): Promise<{ pins: ISkillPin[]; operation: ISkillOperationContext } | undefined> {
  if (
    strategy !== ExecutionStrategyName.CLI_DELEGATE || !source.skillsService || !source.config.skills.inject_in_prompt
  ) {
    return undefined;
  }
  const blueprint = await source.loader.load(agentRole);
  if (!blueprint) throw new Error(`Blueprint not found for agent_role: ${agentRole}`);
  return await prepareFlowSkillPins({
    skills: source.skillsService,
    config: source.config,
    logger: source.logger,
    blueprint,
    request,
    traceId,
  });
}

/** Preserves request declarations when no binding overrides them. */
export function buildStrategyStepOptions(
  agentRole: string,
  portal: string,
  strategy: ExecutionStrategyName,
  effort: IAgentExecutionOptionsInput["effort"],
  thinking: IAgentExecutionOptionsInput["thinking"],
): IAgentExecutionOptionsInput {
  return {
    agent_role: agentRole,
    portal,
    strategy,
    ...(effort === undefined ? {} : { effort }),
    ...(thinking === undefined ? {} : { thinking }),
  };
}
