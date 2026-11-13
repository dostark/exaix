/**
 * @module OutputContractSkills
 * @path packages/core/src/skills/output_contract.ts
 * @description Maps each output contract to its response-contract skill and builds the default skill list from it.
 * @architectural-layer Core
 * @related-files [packages/execution/src/agent_runner_skills.ts, packages/flow/src/flow_skill_pins.ts]
 */

import { OutputContract } from "../types/enums.ts";
import type { Opt, Reason } from "../types/optional_marker.ts";

/** The response-contract skill that carries the template of each output contract. */
export const OUTPUT_CONTRACT_SKILL: Readonly<Record<OutputContract, string>> = {
  [OutputContract.PLAN]: "response-contract",
  [OutputContract.ANALYSIS]: "response-contract-code-analysis",
  [OutputContract.SECURITY]: "response-contract-security-analysis",
  [OutputContract.QA]: "response-contract-qa",
  [OutputContract.PERFORMANCE]: "response-contract-performance",
  [OutputContract.VERDICT]: "response-contract-judge",
};

/** The default skills of a run: the contract skill first, then the declared defaults, each once. */
export function resolveDefaultSkillIds(
  contract: Opt<OutputContract, Reason.OptionalContext>,
  defaults: Opt<readonly string[], Reason.OptionalContext>,
): string[] {
  const ids = contract ? [OUTPUT_CONTRACT_SKILL[contract]] : [];
  for (const id of defaults ?? []) if (!ids.includes(id)) ids.push(id);
  return ids;
}
