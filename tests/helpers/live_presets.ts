/**
 * @module LivePresets
 * @path tests/helpers/live_presets.ts
 * @description Configures and gates an in-process live test by the cell preset of configs/eval-cells.toml that names its service. The `live-<service>` row gives the binding, the catalog entries and the requires_bin, requires_key and requires_optin predicates, and the cell evaluator of the scenario runner decides whether the test runs, so a test and a scenario cell skip for the same named reason.
 * @architectural-layer Test
 * @dependencies [@exaix/schemas, @exaix/testing]
 * @related-files [
 *   "tests/scenario_framework/runner/cell_catalog.ts",
 *   "tests/scenario_framework/runner/matrix_expander.ts"
 * ]
 */

import { join } from "@std/path";
import type { IBindingCatalog, IBindingSpec } from "@exaix/schemas";
import { REPO_ROOT } from "@exaix/testing";
import {
  type ICatalogPreset,
  loadCellCatalog,
  resolveCatalogCells,
} from "../scenario_framework/runner/cell_catalog.ts";
import { cellPredicateSkipReason } from "../scenario_framework/runner/matrix_expander.ts";

const CATALOG_PATH = join(REPO_ROOT, "configs", "eval-cells.toml");
/** The prefix of a preset row that a live test reads. The rest of the name is the service id. */
const LIVE_PRESET_PREFIX = "live-";
const DEFAULT_SELECTOR = "default";

const catalog = await loadCellCatalog(CATALOG_PATH);

/** The row that a live test of `service` reads. */
export function livePresetName(service: string): string {
  return `${LIVE_PRESET_PREFIX}${service}`;
}

function presetOf(service: string): ICatalogPreset {
  const preset = catalog.presets[livePresetName(service)];
  if (preset === undefined) {
    throw new Error(
      `no live preset names service ${service}: add a [tool.${
        livePresetName(service)
      }] row to configs/eval-cells.toml with its binding, key and opt-in`,
    );
  }
  return preset;
}

/** The binding of a service, read from the `default` selector of its preset row. */
export function liveSpecOf(service: string): IBindingSpec {
  const spec = presetOf(service).bindings?.[DEFAULT_SELECTOR];
  if (spec === undefined) throw new Error(`the preset ${livePresetName(service)} declares no default binding`);
  return spec;
}

/** The first missing predicate of the preset of `service`, or null when its live test can run. */
export function liveSkipReason(
  service: string,
  env: Record<string, string | undefined> = Deno.env.toObject(),
): string | null {
  presetOf(service);
  const [cell] = resolveCatalogCells(catalog, [livePresetName(service)]);
  return cellPredicateSkipReason(cell, env);
}

/** The models and services that the `live-*` rows add to the catalog, so every live service is bindable by name. */
export function liveCatalogOverlay(): Partial<IBindingCatalog> {
  const models: NonNullable<IBindingCatalog["models"]> = {};
  const services: NonNullable<IBindingCatalog["services"]> = {};
  for (const [name, preset] of Object.entries(catalog.presets)) {
    if (!name.startsWith(LIVE_PRESET_PREFIX)) continue;
    Object.assign(models, preset.catalog?.models);
    Object.assign(services, preset.catalog?.services);
  }
  return { models, services };
}
