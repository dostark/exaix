/**
 * @module IFlowValidatorService
 * @path src/shared/interfaces/i_flow_validator_service.ts
 * @description Interface for flow validation services.
 * @architectural-layer Shared
 * @related-files [src/services/adapters/flow_validator_adapter.ts, src/cli/cli_context.ts]
 */

import type { IFlow } from "@exaix/schemas";

export interface IFlowValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface IVerifyFlowResult {
  valid: boolean;
  error?: string;
}

export interface IFlowValidatorService {
  /**
   * Validate a flow object.
   */
  validate(flow: IFlow): Promise<IFlowValidationResult>;

  /**
   * Validate a flow from a file path.
   */
  validateFile(path: string): Promise<IFlowValidationResult>;

  /**
   * Validate a flow by ID.
   */
  validateFlow(flowId: string): Promise<IVerifyFlowResult>;
}
