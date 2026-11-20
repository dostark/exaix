/**
 * @module SoloInventoryTypes
 * @path tests/compat/harness/inventory_types.ts
 * @description Row and file shapes of the Solo compatibility inventory.
 */

import type { COMPAT_SCHEMA_VERSION, CompatCaseId } from "./compat_types.ts";

/** The D28 record that every corrected row carries. */
export interface IDefectRecord {
  minimalInput: string;
  oldResult: string;
  violatedRequirement: string;
  correctedResult: string;
  scriptEffect: string;
  regression: string;
}

export interface ISoloInventoryRow {
  id: string;
  boundary: SoloBoundary;
  workflow: string;
  owner: string;
  /** The command path for a row that stands for one shipped command, otherwise null. */
  commandPath: string[] | null;
  startingArtifact: string | null;
  invocation: string;
  expectedResult: string | null;
  negativeCase: string | null;
  disposition: InventoryDisposition;
  /** Observation file paths relative to the evidence directory. */
  evidence: string[];
  defect: IDefectRecord | null;
  caseIds: CompatCaseId[];
  notes: string[];
}

export interface ISoloInventory {
  schemaVersion: typeof COMPAT_SCHEMA_VERSION;
  /** The generated command tree that the cli rows are reconciled against. */
  cliSource: string;
  rows: ISoloInventoryRow[];
}

/** A parsed JSON document, the input of the inventory parser. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** The contract boundaries of the Solo release (strategy, The Solo release contract). */
export const SoloBoundary = {
  CLI: "cli",
  CONFIG: "config",
  BLUEPRINT: "blueprint",
  WORKSPACE: "workspace",
  AGENTS: "agents",
  AUTHORITY: "authority",
} as const;
export type SoloBoundary = typeof SoloBoundary[keyof typeof SoloBoundary];

export const InventoryDisposition = {
  PRESERVED: "preserved",
  CORRECTED: "corrected",
  OPEN: "open",
} as const;
export type InventoryDisposition = typeof InventoryDisposition[keyof typeof InventoryDisposition];
