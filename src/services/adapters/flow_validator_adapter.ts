/**
 * @module FlowValidatorAdapter
 * @path src/services/adapters/flow_validator_adapter.ts
 * @description Adapter for FlowValidatorImpl that satisfies the IFlowValidatorService interface.
 * @architectural-layer Services/Adapters * @related-files ["src/services/flow/flow_validator.ts", "packages/core/src/types/i_flow_validator_service.ts"] */

import type { IFlowValidationResult, IFlowValidatorService } from "@exaix/core/types";
import type { FlowValidatorImpl } from "../flow/flow_validator.ts";
import type { IFlow } from "@exaix/schemas/flow.ts";

export class FlowValidatorAdapter implements IFlowValidatorService {
  constructor(private inner: FlowValidatorImpl) {}

  async validate(flow: IFlow): Promise<IFlowValidationResult> {
    const result = await this.inner.validate(flow);
    return {
      isValid: result.isValid,
      errors: result.errors,
      warnings: result.warnings || [],
    };
  }

  async validateFile(path: string): Promise<IFlowValidationResult> {
    const result = await this.inner.validateFile(path);
    return {
      isValid: result.isValid,
      errors: result.errors,
      warnings: result.warnings || [],
    };
  }
}
