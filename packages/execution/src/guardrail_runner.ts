/**
 * @module GuardrailRunner
 * @path packages/execution/src/guardrail_runner.ts
 * @description Post-output guardrail screening seam (Phase 107, replaces Phase 115 pre-action seam).
 *   Solo injects no runner, so the hook is a pure no-op; Team edition injects GuardrailRunner
 *   (packages-team/guardrail/) which screens agent output against configurable policies.
 * @architectural-layer Services
 * @dependencies [packages/execution/src/strategies/react_loop_strategy.ts]
 * @related-files [packages-team/guardrail/src/guardrail_runner.ts, packages/execution/src/agent_executor.ts]
 */

import type { GuardrailIncident } from "@exaix/schemas";

/**
 * Optional post-output screening seam for the ReAct loop. No-op in Solo (no runner injected).
 * Team edition injects a concurrent GuardrailRunner (P107) that screens agent output against
 * configurable policies. Never throws — policy errors are journaled and non-blocking.
 */
export interface IGuardrailRunner {
  /**
   * Screen one agent-output string against all configured policies.
   * Fire-and-forget from the caller's perspective: resolves when policies settle,
   * but the ReAct loop does NOT await it on the critical path. Never throws —
   * policy errors are journaled as guardrail.screen.error and are not violations.
   */
  screen(
    agentOutput: string,
    traceId: string,
    iteration: number,
  ): Promise<GuardrailIncident[]>;

  /** True iff a block-severity violation has been recorded for this trace. Cheap, synchronous. */
  hasBlockingViolation(traceId: string): boolean;
}
