/**
 * @module GuardrailRunner
 * @path packages/execution/src/guardrail_runner.ts
 * @description Edition-separation seam (Phase 115 Step 1): an optional guardrail screening
 * hook for the ReAct agent loop. Solo injects no runner, so the hook is a pure no-op; paid
 * editions (P107 concurrent guardrail) register an implementation through the edition composer.
 * Core never knows the concrete runner — it only invokes this interface when one is present.
 * @architectural-layer Services
 * @dependencies [packages/execution/src/strategies/react_loop_strategy.ts]
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/execution/src/agent_executor.ts]
 */

import type { IReActAction } from "./strategies/react_loop_strategy.ts";

/** Context passed to a guardrail runner for one ReAct iteration's screening. */
export interface IGuardrailScreenContext {
  /** Trace id of the executing agent run. */
  readonly traceId: string;
  /** Zero-based ReAct iteration index. */
  readonly iteration: number;
  /** The agent's reasoning for this iteration, if any. */
  readonly thought?: string;
  /** The tool actions the agent proposes to execute this iteration. */
  readonly actions: readonly IReActAction[];
}

/**
 * Optional screening seam for the ReAct loop. No-op in Solo (no runner injected). Paid
 * editions register a concurrent implementation (P107) through the edition composer.
 */
export interface IGuardrailRunner {
  /**
   * Fire-and-forget screening of one ReAct iteration's proposed thought + actions.
   * Implementations may screen concurrently; their verdict is observed later via
   * {@link IGuardrailRunner.hasBlockingViolation}. Must not throw.
   */
  screen(context: IGuardrailScreenContext): void;

  /**
   * Whether screening has accumulated a blocking violation for `traceId` that must halt
   * the loop. Checked at the top of each ReAct iteration.
   */
  hasBlockingViolation(traceId: string): boolean;
}
