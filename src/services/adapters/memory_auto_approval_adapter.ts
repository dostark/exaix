/**
 * @module MemoryAutoApprovalAdapter
 * @path src/services/adapters/memory_auto_approval_adapter.ts
 * @description Adapter for MemoryAutoApprovalService to expose CLI-safe methods.
 * @architectural-layer Services/Adapters
 * @related-files [src/services/memory/memory_auto_approval_service.ts, src/cli/commands/memory_commands.ts]
 */

import type { Config } from "../../shared/schemas/config.ts";
import type { IMemoryExtractorService } from "../../shared/interfaces/i_memory_extractor_service.ts";
import type { IMemoryUpdateProposal } from "../../shared/schemas/memory_bank.ts";
import { MemoryAutoApprovalService } from "../memory/memory_auto_approval_service.ts";

export class MemoryAutoApprovalAdapter {
  private readonly inner: MemoryAutoApprovalService;

  constructor(config: Config, memoryExtractor: IMemoryExtractorService) {
    this.inner = new MemoryAutoApprovalService(config, memoryExtractor);
  }

  async listEligible(): Promise<IMemoryUpdateProposal[]> {
    return await this.inner.listEligible();
  }
}
