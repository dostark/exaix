/**
 * @module RegistryNotImplementedError
 * @path packages/model-registry/src/errors.ts
 * @description Error thrown by DefaultModelRegistry methods that belong to the Team+ tier
 *   (latency ranking, etc.) and are not implemented in the Solo floor.
 * @architectural-layer ModelRegistry
 * @related-files [packages/model-registry/src/default_model_registry.ts]
 */
export class RegistryNotImplementedError extends Error {
  constructor(methodName: string) {
    super(
      `${methodName} is not implemented in the Solo DefaultModelRegistry floor. ` +
        `This method belongs to the Team+ live registry (Phase 135).`,
    );
    this.name = "RegistryNotImplementedError";
  }
}
