/**
 * @module ContextCardAdapter
 * @path src/services/adapters/context_card_adapter.ts
 * @description Adapter for ContextCardGenerator that satisfies the IContextCardGeneratorService interface.
 * @architectural-layer Services/Adapters
 * @dependencies [context_card_generator, shared_interfaces]
 * @related-files [src/services/context_card_generator.ts, src/shared/interfaces/i_context_card_generator_service.ts]
 */

import type {
  IContextCardGeneratorService,
  IPortalInfo,
} from "../../shared/interfaces/i_context_card_generator_service.ts";
import type { ContextCardGenerator } from "../context/context_card_generator.ts";

export class ContextCardAdapter implements IContextCardGeneratorService {
  constructor(private inner: ContextCardGenerator) {}

  async generate(portal: IPortalInfo): Promise<void> {
    return await this.inner.generate(portal);
  }
}
