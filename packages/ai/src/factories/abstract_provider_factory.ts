/**
 * @module AbstractProviderFactory
 * @path src/ai/factories/abstract_provider_factory.ts
 * @description Base abstractions for provider factories, defining a lightweight factory interface used by the AI provider registry.
 * @architectural-layer AI
 * @related-files [src/ai/provider_registry.ts]
 */

export interface IProviderFactory<TOptions = object, TResult = object> {
  create(options: TOptions): Promise<TResult>;
}

export abstract class AbstractProviderFactory<TOptions = object, TResult = object>
  implements IProviderFactory<TOptions, TResult> {
  abstract create(options: TOptions): Promise<TResult>;

  protected generateId(provider: string, model: string, id?: string): string {
    return id ?? `${provider}-${model}`;
  }
}
