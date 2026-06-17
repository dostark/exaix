/**
 * @module HitlCapabilityModule
 * @path packages-team/hitl/src/hitl_capability_module.ts
 * @ungrounded
 * @description ICapabilityModule implementation for per-action HITL governance (Phase 118).
 * Asserts CAP_HITL_GOVERNANCE edition mapping and registers the HITL seam with TeamComposer.
 * The policy evaluator is created in main.ts before FlowRunner construction and wired
 * directly into FlowRunner and ExecutionLoop — this module exists for edition-composer
 * seam consistency.
 * @architectural-layer Governance
 * @related-files [packages/core/src/composer/edition_composer.ts, apps/daemon/src/bootstrap_team.ts]
 */

import { EDITION_TEAM } from "@exaix/core";
import { CAP_HITL_GOVERNANCE, CAPABILITY_EDITION } from "@exaix/core/composer";
import type { ICapabilityModule, ISeamRegistryPlaceholder } from "@exaix/core/composer";

export class HitlCapabilityModule implements ICapabilityModule {
  constructor() {
    if (CAPABILITY_EDITION[CAP_HITL_GOVERNANCE] !== EDITION_TEAM) {
      throw new Error(
        `CAP_HITL_GOVERNANCE maps to "${
          CAPABILITY_EDITION[CAP_HITL_GOVERNANCE]
        }" but is being wired in Team edition. ` +
          "Update CAPABILITY_EDITION or move this wiring to the correct bootstrap.",
      );
    }
  }

  registerFlowStepHandlers(_registry: ISeamRegistryPlaceholder): void {
    // HITL governance integrates at the middleware/pipeline level, not via step handlers.
  }
}
