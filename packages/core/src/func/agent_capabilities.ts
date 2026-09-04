/**
 * @module AgentCapabilities
 * @path packages/core/src/func/agent_capabilities.ts
 * @description Helper functions for evaluating and enforcing agent tool capabilities.
 * @architectural-layer Services
 * @related-files ["packages/execution/src/agent_composer.ts", "packages/execution/src/agent_runner.ts"]
 */

import { ToolName } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

export const WRITE_CAPABILITIES_REQUIRING_GIT_TRACKING = [
  ToolName.WRITE_FILE,
  ToolName.GIT_COMMIT,
  ToolName.GIT_CREATE_BRANCH,
] as const;

export type WriteCapabilityRequiringGitTracking = typeof WRITE_CAPABILITIES_REQUIRING_GIT_TRACKING[number];

/** Write-capable if EITHER the legacy `capabilities` list OR `permitted_tools` grants a
 *  write tool — some blueprints only declare write tools via `permitted_tools`. */
export function requiresGitTracking(
  capabilities: readonly string[],
  permittedTools?: Opt<readonly string[], Reason.OptionalInput>,
): boolean {
  const writeTools = WRITE_CAPABILITIES_REQUIRING_GIT_TRACKING as readonly string[];
  if (capabilities.some((cap) => writeTools.includes(cap))) return true;
  return permittedTools?.some((tool) => writeTools.includes(tool)) ?? false;
}

export function isReadOnlyAgentCapabilities(
  capabilities: readonly string[],
  permittedTools?: Opt<readonly string[], Reason.OptionalInput>,
): boolean {
  return !requiresGitTracking(capabilities, permittedTools);
}
