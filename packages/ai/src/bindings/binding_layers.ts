/**
 * @module BindingLayers
 * @path packages/ai/src/bindings/binding_layers.ts
 * @description Reads operator binding layers at run start. Step-2 subset: config only.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas, @exaix/model-registry]
 * @related-files [packages/ai/src/bindings/binding_resolver.ts, packages/ai/src/bindings/model_binding_service.ts]
 */

import { buildBuiltInCatalog, mergeCatalogs } from "@exaix/model-registry";
import { type Config, getDefaultModels, type IBindingLayers } from "@exaix/schemas";

const LAYER_CONFIG = "config";

/** Project the current config.ai selection to a catalog canonical model, when unique. */
export function projectConfigDefaultModel(config: Config, catalog: IBindingLayers["catalog"]): string | undefined {
  const ai = config.ai;
  if (!ai?.provider) return undefined;
  const direct = `${ai.provider}/${ai.model ?? ""}`;
  if (ai.model && catalog.models[direct]) return direct;
  const defaultName = getDefaultModels()[ai.provider];
  const defaultCanonical = `${ai.provider}/${defaultName ?? ""}`;
  return catalog.models[defaultCanonical] ? defaultCanonical : undefined;
}

/**
 * Assemble the operator binding layers from the current config. Step-2 subset: config
 * entries merged over the built-in catalog. Step 4 adds daemon overlays and per-run files.
 */
export function loadBindingLayers(config: Config): IBindingLayers {
  const catalog = mergeCatalogs(buildBuiltInCatalog(), config.catalog ?? {});
  const entries: IBindingLayers["entries"] = Object.entries(config.bindings ?? {}).map(([selector, spec]) => ({
    layer: LAYER_CONFIG,
    selector,
    spec,
  }));
  return {
    entries,
    catalog,
    overlaySha256: [],
    operatorLayersPresent: entries.length > 0,
    configDefaultModel: projectConfigDefaultModel(config, catalog),
  };
}
