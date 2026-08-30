/**
 * @module GuardrailRunner
 * @path packages-team/guardrail/src/guardrail_runner.ts
 * @description Team-edition GuardrailRunner implementation. Screens agent output against configurable
 *   policies using a fast-slot IModelProvider. Never throws — policy errors are journaled as
 *   guardrail.screen.error (non-blocking). Enabled/disabled by config.guardrail.enabled.
 * @architectural-layer Services
 * @dependencies ["packages/ai/src/types.ts:IModelProvider"]
 * @related-files [packages/execution/src/guardrail_runner.ts, packages/core/src/events/domain_event_types.ts]
 */

import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { IModelProvider } from "@exaix/ai";
import type { GuardrailConfig, GuardrailIncident, GuardrailPolicy } from "@exaix/schemas";
import { GUARDRAIL_FLAGGED_EXCERPT_MAX_CHARS, GUARDRAIL_SCREEN_TIMEOUT_MS } from "@exaix/core";
import type { IGuardrailRunner } from "@exaix/execution";

const GUARDRAIL_SOURCE = "guardrail";
const FINAL_ITERATION = Number.MAX_SAFE_INTEGER;
const VERDICT_PASS = "pass";
const VERDICT_VIOLATION = "violation";
const SEVERITY_WARN = "warn";
const SEVERITY_BLOCK = "block";

interface ITraceState {
  incidents: GuardrailIncident[];
  blocking: boolean;
}

export class GuardrailRunner implements IGuardrailRunner {
  readonly #config: GuardrailConfig;
  readonly #provider: IModelProvider;
  readonly #logger: IEventLogger;
  readonly #traces = new Map<string, ITraceState>();

  constructor(
    config: GuardrailConfig,
    screeningProvider: IModelProvider,
    logger: IEventLogger,
  ) {
    this.#config = config;
    this.#provider = screeningProvider;
    this.#logger = logger;
  }

  /**
   * Screens agent output every Nth iteration (check_interval_iterations); final-output
   * calls pass a large iteration sentinel to force screen_final_output handling.
   */
  async screen(
    agentOutput: string,
    traceId: string,
    iteration: number,
  ): Promise<GuardrailIncident[]> {
    if (!this.#config.enabled || this.#config.policies.length === 0) {
      return [];
    }

    // Honour check_interval_iterations: screen only every Nth iteration.
    // The FINAL_ITERATION sentinel bypasses the interval check for final-output screening.
    if (
      iteration !== FINAL_ITERATION &&
      iteration % this.#config.check_interval_iterations !== 0
    ) {
      return [];
    }

    // Honour screen_final_output: if false, skip calls marked with FINAL_ITERATION.
    if (iteration === FINAL_ITERATION && !this.#config.screen_final_output) {
      return [];
    }

    const results = await Promise.allSettled(
      this.#config.policies.map((policy) => this.#evaluatePolicy(policy, agentOutput, traceId, iteration)),
    );

    const incidents: GuardrailIncident[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        incidents.push(result.value);
      }
    }
    return incidents;
  }

  hasBlockingViolation(traceId: string): boolean {
    return this.#traces.get(traceId)?.blocking ?? false;
  }

  async #evaluatePolicy(
    policy: GuardrailPolicy,
    agentOutput: string,
    traceId: string,
    iteration: number,
  ): Promise<GuardrailIncident | null> {
    const prompt = this.#buildPrompt(policy, agentOutput);

    let result: { content: string };
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout")),
          GUARDRAIL_SCREEN_TIMEOUT_MS,
        )
      );
      result = await Promise.race([
        this.#provider.generate(prompt),
        timeout,
      ]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.#logger.info(
        DomainEventType.GuardrailScreenError,
        GUARDRAIL_SOURCE,
        {
          policy_id: policy.policy_id,
          iteration,
          verdict: VERDICT_PASS,
          severity: SEVERITY_WARN,
          error_message: errorMessage,
        },
      );
      return null;
    }

    let verdict: string;
    let explanation: string | undefined;
    try {
      const parsed = JSON.parse(result.content);
      verdict = parsed.verdict ?? VERDICT_PASS;
      explanation = parsed.explanation;
    } catch {
      this.#logger.info(
        DomainEventType.GuardrailScreenError,
        GUARDRAIL_SOURCE,
        {
          policy_id: policy.policy_id,
          iteration,
          verdict: VERDICT_PASS,
          severity: SEVERITY_WARN,
          error_message: "Failed to parse guardrail response",
        },
      );
      return null;
    }

    if (verdict !== VERDICT_VIOLATION) {
      this.#logger.info(DomainEventType.GuardrailScreenPass, GUARDRAIL_SOURCE, {
        policy_id: policy.policy_id,
        iteration,
        verdict: VERDICT_PASS,
        severity: SEVERITY_WARN,
      });
      return null;
    }

    const flaggedExcerpt = agentOutput.length > GUARDRAIL_FLAGGED_EXCERPT_MAX_CHARS
      ? agentOutput.slice(0, GUARDRAIL_FLAGGED_EXCERPT_MAX_CHARS)
      : undefined;

    if (policy.severity === SEVERITY_BLOCK) {
      const state = this.#getOrCreateTrace(traceId);
      state.blocking = true;
      this.#logger.info(DomainEventType.GuardrailBlock, GUARDRAIL_SOURCE, {
        policy_id: policy.policy_id,
        iteration,
        verdict: VERDICT_VIOLATION,
        severity: SEVERITY_BLOCK,
        flagged_excerpt: flaggedExcerpt,
        explanation,
      });
    } else {
      this.#logger.info(DomainEventType.GuardrailWarn, GUARDRAIL_SOURCE, {
        policy_id: policy.policy_id,
        iteration,
        verdict: VERDICT_VIOLATION,
        severity: SEVERITY_WARN,
        flagged_excerpt: flaggedExcerpt,
        explanation,
      });
    }

    const incident: GuardrailIncident = {
      trace_id: traceId,
      policy_id: policy.policy_id,
      iteration,
      verdict: VERDICT_VIOLATION,
      severity: policy.severity,
      flagged_excerpt: flaggedExcerpt,
      explanation,
    };

    const state = this.#getOrCreateTrace(traceId);
    state.incidents.push(incident);

    this.#logger.info(
      DomainEventType.GuardrailScreenViolation,
      GUARDRAIL_SOURCE,
      {
        policy_id: policy.policy_id,
        iteration,
        verdict: VERDICT_VIOLATION,
        severity: policy.severity,
        flagged_excerpt: flaggedExcerpt,
        explanation,
      },
    );

    return incident;
  }

  #buildPrompt(policy: GuardrailPolicy, agentOutput: string): string {
    return [
      `You are evaluating agent output against policy: ${policy.description}`,
      "",
      `Agent output:`,
      agentOutput,
      "",
      `Respond with JSON: { "verdict": "pass" or "violation", "explanation": "..." }`,
    ].join("\n");
  }

  #getOrCreateTrace(traceId: string): ITraceState {
    let state = this.#traces.get(traceId);
    if (!state) {
      state = { incidents: [], blocking: false };
      this.#traces.set(traceId, state);
    }
    return state;
  }
}
