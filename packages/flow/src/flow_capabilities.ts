/**
 * @module FlowCapabilities
 * @path packages/flow/src/flow_capabilities.ts
 * @description Checks installed specialized handlers before a flow starts.
 * @architectural-layer Flows
 * @dependencies [@exaix/core]
 * @related-files [packages/flow/src/flow_runner.ts, apps/daemon/main.ts]
 */
import { FlowStepType } from "@exaix/core";
import { CAP_VOTING, isCapabilityAvailable } from "@exaix/core/composer";
import type { Opt, Reason } from "@exaix/core/types";
import type { IFlowStepHandlerRegistry } from "./step_handlers/step_handler.ts";
import { VotingStepHandler } from "./step_handlers/voting_step_handler.ts";

export const FLOW_CAPABILITY_UNAVAILABLE_CODE = "capability_unavailable";

export class FlowCapabilityUnavailableError extends Error {
  readonly reasonCode = FLOW_CAPABILITY_UNAVAILABLE_CODE;
  constructor(public readonly capability: string) {
    super(`Flow requires unavailable capability '${capability}'`);
    this.name = "FlowCapabilityUnavailableError";
  }
}

/** Generic aliases cannot advertise voting as installed. */
export function getInstalledFlowCapabilities(registry: IFlowStepHandlerRegistry): ReadonlySet<string> {
  const handler = registry.get(FlowStepType.VOTING_GROUP);
  return new Set(
    handler instanceof VotingStepHandler && registry.get(FlowStepType.CONSENSUS) === handler ? [CAP_VOTING] : [],
  );
}

export function assertFlowCapabilities(
  required: readonly string[],
  edition: Opt<string, Reason.OptionalInput>,
  installed: ReadonlySet<string>,
  registry: IFlowStepHandlerRegistry,
): void {
  const registered = getInstalledFlowCapabilities(registry);
  if (installed.has(CAP_VOTING) && !registered.has(CAP_VOTING)) throw new FlowCapabilityUnavailableError(CAP_VOTING);
  const available = new Set([...installed].filter((capability) => registered.has(capability)));
  for (const capability of required) {
    if (!isCapabilityAvailable(capability, edition, available)) throw new FlowCapabilityUnavailableError(capability);
  }
}
