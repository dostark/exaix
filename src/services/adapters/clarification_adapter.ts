/**
 * @module ClarificationAdapter
 * @path src/services/adapters/clarification_adapter.ts
 * @description Adapter for clarification session persistence, exposing
 * loadClarification and saveClarification for CLI layer consumption.
 * @architectural-layer Services
 * * @related-files [src/services/quality_gate/clarification_persistence.ts, src/cli/handlers/request_clarify_handler.ts]
 */

import { loadClarification, saveClarification } from "../quality_gate/clarification_persistence.ts";
import type { IClarificationSession } from "../../shared/schemas/clarification_session.ts";

export class ClarificationAdapter {
  async load(requestFilePath: string): Promise<IClarificationSession | null> {
    return await loadClarification(requestFilePath);
  }

  async save(requestFilePath: string, session: IClarificationSession): Promise<void> {
    await saveClarification(requestFilePath, session);
  }
}
