/**
 * @module ResolveIdentityModel
 * @path packages/ai/src/resolve_identity_model.ts
 * @description Phase 131 Step 6 (GAP-3) — resolves an identity's declarative model
 *   preferences into a concrete {provider, model} pair. Precedence: an explicit
 *   `model` (provider:model) wins; otherwise the preferences are mapped onto
 *   ISelectionCriteria, ProviderSelector picks the provider name, and the concrete
 *   model is read from getDefaultModels() for that provider. Unsupported hints
 *   (thinking/effort) degrade gracefully. This is the identity-local resolver;
 *   Phase 132 generalizes it into a shared ModelResolver.
 * @architectural-layer AI
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/ai/src/provider_selector.ts, apps/daemon/main.ts]
 */

import { TaskComplexity } from "@exaix/core";
import { getDefaultModels } from "@exaix/schemas";
import type { ISelectionCriteria } from "./provider_selector.ts";

/** A declarative model size tier declared on an identity. */
export type ModelSize = "S" | "M" | "L" | "XL";

/** Structural selector shape consumed by resolveIdentityModel (avoids coupling to the ProviderSelector class). */
export interface ISelectorLike {
  selectProvider(criteria: ISelectionCriteria): Promise<string>;
}

/** Declarative model preferences read from an identity's frontmatter; all fields are optional. */
export interface IModelPreferences {
  /** Explicit provider:model override (highest precedence; e.g. mock-agent). */
  model?: string;
  /** Preferred provider hint, mapped to a required capability. */
  preferred_provider?: string;
  /** Size tier mapped onto task complexity for provider selection. */
  model_size?: ModelSize;
  /** Extended-thinking hint; ignored by providers that do not support it. */
  thinking?: boolean;
  /** Reasoning-effort hint; ignored by providers that do not support it. */
  effort?: string;
}

/** A concrete resolution: a provider name and a concrete model id. */
export interface IResolvedModel {
  provider: string;
  model: string;
}

const SIZE_TO_COMPLEXITY: Readonly<Record<ModelSize, TaskComplexity>> = {
  S: TaskComplexity.SIMPLE,
  M: TaskComplexity.MEDIUM,
  L: TaskComplexity.COMPLEX,
  XL: TaskComplexity.EPIC,
};

/** Split a canonical `provider:model` string into its parts. */
function splitCanonical(canonical: string): IResolvedModel {
  const idx = canonical.indexOf(":");
  if (idx === -1) return { provider: canonical, model: canonical };
  return { provider: canonical.slice(0, idx), model: canonical.slice(idx + 1) };
}

/**
 * `thinking`/`effort` are accepted but intentionally not forwarded to the selector — they
 * are provider-level execution hints with no influence on which provider/model is chosen.
 */
export async function resolveIdentityModel(
  prefs: IModelPreferences,
  selector: ISelectorLike,
): Promise<IResolvedModel> {
  // 1. Explicit override wins.
  if (prefs.model && prefs.model.trim().length > 0) {
    return splitCanonical(prefs.model.trim());
  }

  const defaults = getDefaultModels();

  // 2. A preferred provider is an explicit identity preference: honor it directly
  //    when it is a known provider, rather than treating its name as a capability.
  if (prefs.preferred_provider && defaults[prefs.preferred_provider] !== undefined) {
    return { provider: prefs.preferred_provider, model: defaults[prefs.preferred_provider] };
  }

  // 3. Otherwise map the size tier onto selection criteria and let the selector
  //    pick a provider; the concrete model comes from the provider default map.
  const criteria: ISelectionCriteria = {
    taskComplexity: prefs.model_size ? SIZE_TO_COMPLEXITY[prefs.model_size] : undefined,
  };
  const provider = await selector.selectProvider(criteria);
  const model = defaults[provider] ?? provider;
  return { provider, model };
}
