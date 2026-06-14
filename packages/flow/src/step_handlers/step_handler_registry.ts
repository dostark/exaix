/**
 * @module FlowStepHandlerRegistry
 * @path packages/flow/src/step_handlers/step_handler_registry.ts
 * @description Concrete Map-based implementation of IFlowStepHandlerRegistry.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/step_handlers/step_handler.ts, packages/flow/src/flow_runner.ts]
 */

import type { IFlowStepHandler, IFlowStepHandlerRegistry } from "./step_handler.ts";

/**
 * Map-based registry for flow step handlers.
 * Thread-safe for reads after all registration is complete (registration happens at init).
 */
export class FlowStepHandlerRegistry implements IFlowStepHandlerRegistry {
  readonly #handlers = new Map<string, IFlowStepHandler>();

  register(handler: IFlowStepHandler): void {
    this.#handlers.set(handler.stepType, handler);
  }

  /**
   * Register a handler under a specific key, overriding its stepType.
   * Useful for aliasing (e.g. AgentStepHandler for BRANCH and CONSENSUS).
   */
  registerWithKey(key: string, handler: IFlowStepHandler): void {
    this.#handlers.set(key, handler);
  }

  get(stepType: string): IFlowStepHandler | undefined {
    return this.#handlers.get(stepType);
  }

  has(stepType: string): boolean {
    return this.#handlers.has(stepType);
  }

  keys(): string[] {
    return Array.from(this.#handlers.keys());
  }
}
