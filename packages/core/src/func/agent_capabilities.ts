/**
 * @module AgentCapabilities
 * @path packages/core/src/func/agent_capabilities.ts
 * @description Helper functions for evaluating and enforcing agent tool capabilities.
 * @architectural-layer Services
 * @related-files ["packages/core/src/func/agent_executor.ts", "packages/core/src/func/agent_runner.ts"]
 */

import { ToolName } from "@exaix/core";

export const WRITE_CAPABILITIES_REQUIRING_GIT_TRACKING = [
  ToolName.WRITE_FILE,
  ToolName.GIT_COMMIT,
  ToolName.GIT_CREATE_BRANCH,
] as const;

export type WriteCapabilityRequiringGitTracking = typeof WRITE_CAPABILITIES_REQUIRING_GIT_TRACKING[number];

export function requiresGitTracking(capabilities: readonly string[]): boolean {
  return capabilities.some((cap) => (WRITE_CAPABILITIES_REQUIRING_GIT_TRACKING as readonly string[]).includes(cap));
}

export function isReadOnlyAgentCapabilities(capabilities: readonly string[]): boolean {
  return !requiresGitTracking(capabilities);
}
