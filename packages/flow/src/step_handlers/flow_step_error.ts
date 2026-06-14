/**
 * @module UnknownFlowStepError
 * @path packages/flow/src/step_handlers/flow_step_error.ts
 * @description Error raised when a flow step type has no registered handler.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/step_handlers/step_handler.ts]
 */

/**
 * Error raised when no IFlowStepHandler is registered for a step type.
 * Includes the unknown stepType, optional stepId, and registered known types for diagnostics.
 */
export class UnknownFlowStepError extends Error {
  override readonly name = "UnknownFlowStepError";

  constructor(
    /** The step type string that has no registered handler. */
    public readonly stepType: string,
    /** Optional step ID for diagnostics. */
    public readonly stepId: string = "",
    /** Registered known types for debugging. */
    public readonly knownTypes: readonly string[] = [],
  ) {
    const idPart = stepId ? ` (stepId: ${stepId})` : "";
    const knownPart = knownTypes.length > 0 ? `. Known types: [${knownTypes.join(", ")}]` : "";
    super(`Unknown flow step type: "${stepType}"${idPart}${knownPart}`);
  }
}
