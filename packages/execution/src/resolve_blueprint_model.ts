/**
 * @module ResolveBlueprintModel
 * @path packages/execution/src/resolve_blueprint_model.ts
 * @description Phase 131 Step 6 (GAP-3 wiring) — resolves a blueprint's model
 *   preferences into a canonical `provider:model` string. Precedence: explicit
 *   `provider:model` in the `model` field wins; legacy `provider`+`model` fields
 *   combine; otherwise declarative preferences (model_size, preferred_provider)
 *   go through resolveIdentityModel. This is the production seam that AgentExecutor
 *   delegates to for identity-level model resolution.
 * @architectural-layer Execution
 * @dependencies [@exaix/ai, @exaix/schemas]
 * @related-files [packages/execution/src/agent_executor.ts, packages/ai/src/resolve_identity_model.ts]
 */

import { getDefaultModels } from "@exaix/schemas";
import { resolveIdentityModel } from "@exaix/ai";
import type { IModelPreferences, ISelectorLike } from "@exaix/ai";

/** Minimal blueprint shape consumed by the resolver. */
export interface IResolvableBlueprint {
  model: string;
  provider?: string;
  model_size?: string;
  preferred_provider?: string;
  thinking?: boolean;
  effort?: string;
}

/**
 * Resolve a blueprint's model information into a canonical `provider:model` id.
 *
 * 1. If `model` already contains `:` → return as-is (explicit override).
 * 2. If `provider` is set → combine as `provider:model` (legacy path).
 * 3. If a `selector` is provided and the blueprint carries model preferences →
 *    delegate to `resolveIdentityModel` for a concrete `{provider, model}`.
 * 4. Fallback → `default:{model}`.
 */
export async function resolveBlueprintModelId(
  blueprint: IResolvableBlueprint,
  selector?: ISelectorLike,
): Promise<string> {
  // 1. Explicit canonical model (provider:model) — highest precedence.
  if (blueprint.model.includes(":")) {
    return blueprint.model;
  }

  // 2. Legacy separate provider + model fields.
  if (blueprint.provider) {
    return `${blueprint.provider}:${blueprint.model}`;
  }

  // 3. Declarative preferences via ProviderSelector.
  if (selector && (blueprint.model_size || blueprint.preferred_provider)) {
    const prefs: IModelPreferences = {
      model_size: blueprint.model_size as IModelPreferences["model_size"],
      preferred_provider: blueprint.preferred_provider,
      thinking: blueprint.thinking,
      effort: blueprint.effort,
    };
    const resolved = await resolveIdentityModel(prefs, selector);
    return `${resolved.provider}:${resolved.model}`;
  }

  // 4. Fallback — use the default model for the default provider.
  const defaults = getDefaultModels();
  const defaultProvider = Object.keys(defaults)[0] ?? FALLBACK_PROVIDER;
  return `${defaultProvider}:${blueprint.model || FALLBACK_MODEL_ID}`;
}

/** Fallback provider name when no model preferences or selector are available. */
const FALLBACK_PROVIDER = "default";

/** Fallback model id when none is present on the blueprint. */
const FALLBACK_MODEL_ID = "default";
