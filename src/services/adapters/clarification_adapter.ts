/**
 * @module ClarificationAdapter
 * @path src/services/adapters/clarification_adapter.ts
 * @description Adapter for clarification session persistence, exposing
 * loadClarification and saveClarification for CLI layer consumption.
 * @architectural-layer Services
 * @related-files ["packages/quality-gate/src/clarification_persistence.ts", "apps/exactl/src/handlers/request_clarify_handler.ts"]
 */

import { loadClarification, saveClarification } from "@exaix/quality-gate";
import type { IClarificationSession } from "@exaix/schemas/clarification_session.ts";

export class ClarificationAdapter {
  async load(requestFilePath: string): Promise<IClarificationSession | null> {
    return await loadClarification(requestFilePath);
  }

  async save(requestFilePath: string, session: IClarificationSession): Promise<void> {
    await saveClarification(requestFilePath, session);
  }
}
