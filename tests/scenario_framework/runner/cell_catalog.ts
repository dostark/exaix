/**
 * @module ScenarioFrameworkCellCatalog
 * @path tests/scenario_framework/runner/cell_catalog.ts
 * @description Phase 203 Step 2 — the eval cell catalog, `configs/eval-cells.toml`, read as a
 *   set of named presets. A scenario selects presets with `matrix.from_catalog` instead of
 *   copying a config path, a provider label and the prerequisite predicates into every cell.
 *   Each `[tool.<name>]` row is one preset named `<name>`. The resolver turns preset names
 *   into real `matrix.cells` entries, so every downstream reader keeps its existing shape.
 *
 *   Two fields are deliberately informative only. `model` is a history-attribution label,
 *   and it is also the source of the preset's `bindings.default` canonical model id.
 *   `native_tools` is documentary: the bound config's own `native_tools_enabled` decides.
 * @architectural-layer Test
 * @dependencies [zod, @std/toml, @exaix/schemas]
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts, tests/scenario_framework/runner/synthetic_runner.ts]
 */

import { z } from "zod";
import { parse as parseToml } from "@std/toml";
import { BINDING_ID_PATTERN, BindingCatalogSchema, BindingsTableSchema, CatalogServiceSchema } from "@exaix/schemas";
import { type IMatrixBlock, type IMatrixCell, MatrixCellSchema } from "./matrix_expander.ts";
import type { IScenario } from "../schema/scenario_schema.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { SENTINEL_COMPAT_FIXTURE_PORT } from "./sentinels.ts";

/** One `[tool.<name>]` row, normalized into the preset it declares. */
export interface ICatalogPreset {
  /** The matrix cell's `tool` — the delegate binary name, or `exactl`. Default `exactl`. */
  tool: string;
  /** The config preset the cell boots with. The provider realm follows from it. */
  config: string;
  /** Provider label for history attribution. Must match the config's `[ai].provider`. */
  provider: string;
  /** Model label for history attribution. Must match the config's `[ai].model` when set. */
  model?: string;
  /** The binary that must be on PATH. Defaults to `true` when the row gates on a key. */
  requires_bin?: string;
  /** The env var that must be set, when the provider needs an API key. */
  requires_key?: string;
  /** The env var that gates this preset. An unset opt-in records the cell as skipped. */
  requires_optin?: string;
  /** Documentary only: the config's own `native_tools_enabled` value decides at runtime. */
  native_tools?: boolean;
  /** The cell-layer bindings this preset contributes. Empty for a CLI-delegate preset. */
  bindings?: IScenario["bindings"];
  /** Catalog entries this preset contributes, with any fixture-port sentinel still in place. */
  catalog?: IScenario["catalog"];
}

/** The presets one catalog file declares, keyed by row name. */
export interface ICellCatalog {
  presets: Record<string, ICatalogPreset>;
}

/** The `tool` a preset gets when its row does not name one. */
export const DEFAULT_PRESET_TOOL = "exactl";

/** The `requires_bin` a preset gets when its row gates on a key instead of a binary.
 *  It names a binary that is always present, so the key check alone decides runnability. */
export const PRESET_ALWAYS_PRESENT_BIN = "true";

/** The catalog shape a preset may carry. Its endpoint stays a plain string.
 *  A preset loads before the fixture port exists, so it may still hold the sentinel. */
const SentinelTolerantCatalogSchema = BindingCatalogSchema.extend({
  services: z.record(
    z.string().regex(BINDING_ID_PATTERN),
    CatalogServiceSchema.extend({ endpoint: z.string().optional() }),
  ).optional(),
});

/** The matrix cell schema with the sentinel-tolerant catalog. It applies only while the fixture
 *  port is unknown, because such a cell cannot run without that port. */
const CellWithSentinelTolerantCatalogSchema = MatrixCellSchema.extend({
  catalog: SentinelTolerantCatalogSchema.optional(),
});

/** The catalog shape a preset carries, as the scenario schema types it. */
type PresetCatalog = NonNullable<IScenario["catalog"]>;

/** The raw row shape, before the defaults are applied. */
const PresetRowSchema = z.object({
  tool: z.string().min(1).optional(),
  config: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1).optional(),
  requires_bin: z.string().min(1).optional(),
  requires_key: z.string().min(1).optional(),
  requires_optin: z.string().min(1).optional(),
  native_tools: z.boolean().optional(),
  bindings: BindingsTableSchema.optional(),
  catalog: SentinelTolerantCatalogSchema.optional(),
}).strict();

/** The parsed catalog file: one table of rows, keyed by preset name. */
const CatalogFileSchema = z.object({
  tool: z.record(z.string().min(1), PresetRowSchema),
}).strict();

/** Apply the documented defaults to one raw row. */
function toPreset(row: z.infer<typeof PresetRowSchema>): ICatalogPreset {
  return {
    tool: row.tool ?? DEFAULT_PRESET_TOOL,
    config: row.config,
    provider: row.provider,
    ...(row.model !== undefined ? { model: row.model } : {}),
    // An API row gates on its key, so its binary gate is a stand-in that is always satisfied.
    ...(row.requires_bin !== undefined
      ? { requires_bin: row.requires_bin }
      : row.requires_key !== undefined
      ? { requires_bin: PRESET_ALWAYS_PRESENT_BIN }
      : {}),
    ...(row.requires_key !== undefined ? { requires_key: row.requires_key } : {}),
    ...(row.requires_optin !== undefined ? { requires_optin: row.requires_optin } : {}),
    ...(row.native_tools !== undefined ? { native_tools: row.native_tools } : {}),
    ...(row.bindings !== undefined ? { bindings: row.bindings } : {}),
    ...(row.catalog !== undefined ? { catalog: row.catalog } : {}),
  };
}

/** Read one eval cell catalog file. A malformed row fails at load, and the fixture-port sentinel stays. */
export async function loadCellCatalog(catalogPath: string): Promise<ICellCatalog> {
  const raw = await Deno.readTextFile(catalogPath);
  const parsed = CatalogFileSchema.safeParse(parseToml(raw));
  if (!parsed.success) {
    throw new Error(`cell catalog ${catalogPath} is invalid: ${parsed.error.issues[0]?.message ?? "parse failed"}`);
  }

  const presets: Record<string, ICatalogPreset> = {};
  for (const [name, row] of Object.entries(parsed.data.tool)) {
    presets[name] = toPreset(row);
  }
  return { presets };
}

/** Replace the fixture-port sentinel in every service endpoint a preset catalog declares. */
function substituteFixturePort(catalog: PresetCatalog, port: number): PresetCatalog {
  if (catalog.services === undefined) return catalog;
  const services: NonNullable<PresetCatalog["services"]> = {};
  for (const [serviceId, service] of Object.entries(catalog.services)) {
    services[serviceId] = service.endpoint === undefined
      ? service
      : { ...service, endpoint: service.endpoint.replaceAll(SENTINEL_COMPAT_FIXTURE_PORT, String(port)) };
  }
  return { ...catalog, services };
}

/** True when any service endpoint in the preset catalog still holds the fixture-port sentinel. */
function hasFixturePortSentinel(catalog: PresetCatalog): boolean {
  return Object.values(catalog.services ?? {}).some((service) =>
    service.endpoint?.includes(SENTINEL_COMPAT_FIXTURE_PORT) ?? false
  );
}

/** Turn preset names into matrix cells in declared order. An unknown name throws instead of dropping a cell. */
export function resolveCatalogCells(
  catalog: ICellCatalog,
  presetNames: readonly string[],
  compatFixturePort: Opt<number, Reason.OptionalInput> = undefined,
): IMatrixCell[] {
  return presetNames.map((name) => {
    const preset = catalog.presets[name];
    if (!preset) {
      throw new Error(`unknown cell preset '${name}' — not declared in the eval cell catalog`);
    }
    if (!preset.requires_bin) {
      throw new Error(`cell preset '${name}' declares neither requires_bin nor requires_key`);
    }
    const sentinelCatalog = preset.catalog !== undefined && hasFixturePortSentinel(preset.catalog);
    const raw = {
      tool: preset.tool,
      provider: preset.provider,
      config: preset.config,
      requires_bin: preset.requires_bin,
      ...(preset.requires_key !== undefined ? { requires_key: preset.requires_key } : {}),
      ...(preset.requires_optin !== undefined ? { requires_optin: preset.requires_optin } : {}),
      ...(preset.bindings !== undefined ? { bindings: preset.bindings } : {}),
      ...(sentinelCatalog && compatFixturePort !== undefined
        ? { catalog: substituteFixturePort(preset.catalog!, compatFixturePort) }
        : preset.catalog !== undefined
        ? { catalog: preset.catalog }
        : {}),
    };
    // Without a port the cell cannot run, so the sentinel-tolerant shape only serves the skip decision.
    if (sentinelCatalog && compatFixturePort === undefined) {
      return CellWithSentinelTolerantCatalogSchema.parse(raw);
    }
    // The cell schema is the contract every other reader relies on, so validate against it.
    return MatrixCellSchema.parse(raw);
  });
}

/** Resolve a scenario's matrix into concrete cells. An inline `cells` block passes through as
 *  declared. A `from_catalog` block resolves its preset names against the catalog. */
export function resolveScenarioMatrixCells(
  matrix: IMatrixBlock,
  catalog: ICellCatalog,
  compatFixturePort: Opt<number, Reason.OptionalInput> = undefined,
): IMatrixCell[] {
  return matrix.from_catalog
    ? resolveCatalogCells(catalog, matrix.from_catalog, compatFixturePort)
    : matrix.cells ?? [];
}
