/**
 * @module CapabilityConstants
 * @path packages/core/src/composer/capabilities.ts
 * @description Edition capability IDs and their tier mappings. Used by the Deferred Phase Wire-up
 *   to replace the documentation-only edition availability table in packages/ai/README.md with
 *   programmatic constants.
 *
 *   Each capability ID represents a feature that shipped un-gated and is positioned for a specific
 *   edition tier. The CAPABILITY_EDITION map records the intended tier for build-time scoping.
 *
 *   These constants are NOT a runtime entitlement check — that is Phase B work. They serve as the
 *   single source of truth for which edition a feature belongs to, used by build-time gating and
 *   documentation.
 *
 * @architectural-layer Shared
 * @related-files ["packages/core/src/types/constants.ts", "packages/ai/README.md", "apps/common/registry_bootstrap.ts"]
 */

import { EDITION_ENTERPRISE, EDITION_TEAM } from "../types/constants.ts";

// Capability IDs

/** P113: VOTING_GROUP step type — Team/Enterprise only */
export const CAP_VOTING = "voting";

/** P118: Per-action HITL governance surface — Team/Enterprise only */
export const CAP_HITL_GOVERNANCE = "hitl_governance";

/** P107: Advanced guardrail policies — Team/Enterprise only */
export const CAP_GUARDRAIL_ADVANCED = "guardrail_advanced";

/** P119: Extended-language portal symbol extraction (Rust/Go/Java + long tail) — Team/Enterprise only.
 *  Python and TS/JS ship un-gated in Solo; this capability gates only the extended-language extractors. */
export const CAP_EXTENDED_LANG_EXTRACTION = "extended_lang_extraction";

/** P134: Live model registry (DB-backed, refreshable) — Team only */
export const CAP_MODEL_REGISTRY_LIVE = "model_registry_live";

/** P134: Multi-provider routing rigor (cost-aware, latency-aware) — Team only */
export const CAP_MODEL_ROUTING_RIGOR = "model_routing_rigor";

/** P134/draft: Enterprise model governance (admission, audit) — Enterprise only, reserved */
export const CAP_MODEL_REGISTRY_GOVERNANCE = "model_registry_governance";

// Edition tier map

/** Maps each capability ID to its required edition tier. */
export const CAPABILITY_EDITION: Record<string, string> = {
  [CAP_VOTING]: EDITION_TEAM,
  [CAP_HITL_GOVERNANCE]: EDITION_TEAM,
  [CAP_GUARDRAIL_ADVANCED]: EDITION_TEAM,
  // OpenRouter intentionally omitted: it ships in Solo (all editions) per edition decision
  // D5b/D-providers — a BYO-key, independently-free aggregator, not a Team gate.
  [CAP_EXTENDED_LANG_EXTRACTION]: EDITION_TEAM,
  [CAP_MODEL_REGISTRY_LIVE]: EDITION_TEAM,
  [CAP_MODEL_ROUTING_RIGOR]: EDITION_TEAM,
  [CAP_MODEL_REGISTRY_GOVERNANCE]: EDITION_ENTERPRISE,
};
