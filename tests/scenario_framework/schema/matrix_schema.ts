/**
 * @module ScenarioMatrixSchema
 * @path tests/scenario_framework/schema/matrix_schema.ts
 * @description The matrix block schema of a scenario and the cell contract it expands.
 * @architectural-layer TestSupport
 * @dependencies [zod, @exaix/schemas]
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts, tests/scenario_framework/runner/matrix_expander.ts]
 */

import { z } from "zod";
import { BindingCatalogSchema, BindingsTableSchema } from "@exaix/schemas";

/** A non-empty string field. */
const NON_EMPTY = z.string().min(1);

/** One matrix cell: a tool, a provider and a real config preset. The config block chooses the provider realm. */
export const MatrixCellSchema = z.object({
  tool: NON_EMPTY,
  provider: NON_EMPTY,
  config: NON_EMPTY,
  requires_bin: NON_EMPTY,
  requires_key: NON_EMPTY.optional(),
  requires_optin: NON_EMPTY.optional(),
  harness: z.enum(["bare"]).optional(),
  /** The ablation subsystem token. When set, the cell runs with exactly that subsystem off
   *  and records an ablation cell id. */
  ablate: NON_EMPTY.optional(),
  /** The cell layer bindings, written above the scenario layer as `20-cell.json`. */
  bindings: BindingsTableSchema.optional(),
  /** Catalog entries this cell adds. A cell catalog is validated strictly, so it cannot carry
   *  the fixture-port sentinel. A catalog PRESET loaded from TOML may, and is substituted later. */
  catalog: BindingCatalogSchema.optional(),
}).strict();

/** The matrix block. A scenario names its cells once, inline or by catalog preset. */
export const MatrixSchema = z.object({
  cells: z.array(MatrixCellSchema).min(1).optional(),
  /** Catalog preset names, resolved from `tests/configs/model_presets.toml` before expansion. */
  from_catalog: z.array(NON_EMPTY).min(1).optional(),
}).strict().refine(
  (matrix) => (matrix.cells === undefined) !== (matrix.from_catalog === undefined),
  { message: "a matrix must declare exactly one of cells or from_catalog" },
);

export type IMatrixCell = z.infer<typeof MatrixCellSchema>;
export type IMatrixBlock = z.infer<typeof MatrixSchema>;
