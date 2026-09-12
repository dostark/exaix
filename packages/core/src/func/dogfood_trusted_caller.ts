/**
 * @module DogfoodTrustedCaller
 * @path packages/core/src/func/dogfood_trusted_caller.ts
 * @description Pure authorization check binding dogfood bounded-context activation to a
 * daemon-resolved agent-role identity. The trusted-role set is owned by daemon composition
 * (`dogfood.context.trusted_agent_roles` config), injected at construction into each
 * consumer; this function only compares the caller's own agentRole against it — it never
 * reads config, prompt, or request text itself.
 * @architectural-layer Core
 * @related-files [apps/daemon/src/session_delegation_coordinator.ts, packages/execution/src/strategies/cli_delegate_strategy.ts]
 */

/** True only when `agentRole` is a non-empty member of `trustedAgentRoles`. An absent or
 *  empty agentRole is never trusted, matching Phase 176 Step 6's "reject...absent bindings". */
export function isTrustedDogfoodCaller(
  agentRole: string,
  trustedAgentRoles: ReadonlySet<string>,
): boolean {
  return agentRole.length > 0 && trustedAgentRoles.has(agentRole);
}
