/**
 * @module ContextCardAdapter
 * @path src/services/adapters/context_card_adapter.ts
 * @description Adapter for ContextCardGenerator that satisfies the IContextCardGeneratorService interface.
 * @architectural-layer Services/Adapters
 * @related-files ["src/services/context/context_card_generator.ts", "packages/core/src/types/i_context_card_generator_service.ts"]
 */

import type { IContextCardGeneratorService, IContextCardPortalInfo } from "@exaix/core/types";
import type { ContextCardGenerator } from "../context/context_card_generator.ts";

export class ContextCardAdapter implements IContextCardGeneratorService {
  constructor(private inner: ContextCardGenerator) {}

  async generate(portal: IContextCardPortalInfo): Promise<void> {
    return await this.inner.generate(portal);
  }
}
