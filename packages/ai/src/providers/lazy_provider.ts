/**
 * @module LazyProvider
 * @path packages/ai/src/providers/lazy_provider.ts
 * @description Defers provider initialization until first use to optimize startup time and avoid unnecessary early API/auth checks.
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_registry.ts]
 */
import type { Opt, Reason } from "@exaix/core/types";

import type { IModelOptions, IModelProvider, IResolvedProviderOptions } from "../types.ts";
import type { IGenerateResult } from "./common.ts";
import type { IProviderFactory } from "../factories/abstract_provider_factory.ts";

export class LazyProvider implements IModelProvider {
  private instance: IModelProvider | null = null;
  public readonly id: string;

  constructor(
    private factory: IProviderFactory,
    private options: IResolvedProviderOptions,
    id?: Opt<string, Reason.SensibleDefault>,
  ) {
    this.id = id ?? options.id ?? `${options.provider}-${options.model}`;
  }

  /**
   * Initialize on first use
   */
  private async getInstance(): Promise<IModelProvider> {
    if (!this.instance) {
      this.instance = await this.factory.create(this.options);
    }
    return this.instance;
  }

  /**
   * Delegate generate call to the lazily created instance
   */
  async generate(prompt: string, options?: Opt<IModelOptions, Reason.ExecutionConfig>): Promise<IGenerateResult> {
    const provider = await this.getInstance();
    return provider.generate(prompt, options);
  }
}
