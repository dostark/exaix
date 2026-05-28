/**
 * @module ContextBudgetError
 * @path packages/core/src/errors/context_budget_error.ts
 * @description Error thrown when prompt budget enforcement detects total estimated
 * tokens exceed the model's context window.
 * @architectural-layer Core
 * @related-files [packages/core/src/errors/safe_error.ts]
 */

/**
 * Error raised when the estimated total token usage exceeds the allocated
 * context window for a model. Contains the section breakdown and metrics
 * for diagnostic logging.
 */
export class ContextBudgetExceededError extends Error {
  constructor(
    message: string,
    public readonly model: string,
    public readonly contextWindow: number,
    public readonly estimatedTokens: number,
    public readonly sectionBreakdown: Record<string, number>,
  ) {
    super(message);
    this.name = "ContextBudgetExceededError";
  }
}
