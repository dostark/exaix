/**
 * @module SoloInventory
 * @path tests/compat/harness/inventory.ts
 * @description Loads, parses and reconciles the Solo compatibility inventory with the generated command tree.
 */

import { z } from "zod";
import { COMPAT_SCHEMA_VERSION, CompatCaseId } from "./compat_types.ts";
import { InventoryDisposition, SoloBoundary } from "./inventory_types.ts";
import type { ISoloInventory, JsonValue } from "./inventory_types.ts";

export const INVENTORY_PATH = "exaix-dev-docs/evidence/go-port/solo_inventory.json";
export const CLI_TREE_PATH = "docs/cli/exactl-cli.json";
export const PENDING_REVIEW_WORKFLOW = "pending-review";

/** Suspected defects found while drafting. A case step confirms or dismisses each one. */
export const CANDIDATE_ROW_IDS = [
  "candidate:reviews-status-not-written",
  "candidate:reference-text-merges-into-main",
  "candidate:artifact-write-order",
] as const;

const COMMAND_SEPARATOR = " ";

const DefectRecordSchema = z.object({
  minimalInput: z.string(),
  oldResult: z.string(),
  violatedRequirement: z.string(),
  correctedResult: z.string(),
  scriptEffect: z.string(),
  regression: z.string(),
});

const RowSchema = z.object({
  id: z.string().min(1),
  boundary: z.enum(Object.values(SoloBoundary) as [SoloBoundary, ...SoloBoundary[]]),
  workflow: z.string().min(1),
  owner: z.string().min(1),
  commandPath: z.array(z.string().min(1)).min(1).nullable(),
  startingArtifact: z.string().nullable(),
  invocation: z.string().min(1),
  expectedResult: z.string().nullable(),
  negativeCase: z.string().nullable(),
  disposition: z.enum(Object.values(InventoryDisposition) as [InventoryDisposition, ...InventoryDisposition[]]),
  evidence: z.array(z.string()),
  defect: DefectRecordSchema.nullable(),
  caseIds: z.array(z.enum(Object.values(CompatCaseId) as [CompatCaseId, ...CompatCaseId[]])),
  notes: z.array(z.string()),
});

const InventorySchema = z.object({
  schemaVersion: z.literal(COMPAT_SCHEMA_VERSION),
  cliSource: z.string().min(1),
  rows: z.array(RowSchema),
});

const CommandTreeSchema = z.object({
  commands: z.array(z.object({ path: z.array(z.string().min(1)).min(1) })),
});

export function parseInventory(raw: JsonValue): ISoloInventory {
  return InventorySchema.parse(raw);
}

export async function loadInventory(path: string = INVENTORY_PATH): Promise<ISoloInventory> {
  return parseInventory(JSON.parse(await Deno.readTextFile(path)));
}

export async function loadCommandPaths(path: string = CLI_TREE_PATH): Promise<string[][]> {
  const tree = CommandTreeSchema.parse(JSON.parse(await Deno.readTextFile(path)));
  return tree.commands.map((command) => command.path);
}

/** Returns one message per problem, in a stable order. An empty list means the inventory is consistent. */
export function validateInventory(inventory: ISoloInventory, commandPaths: string[][]): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const rowCommands = new Map<string, number>();

  for (const row of inventory.rows) {
    if (seenIds.has(row.id)) problems.push(`duplicate row id: ${row.id}`);
    seenIds.add(row.id);
    if (row.disposition === InventoryDisposition.CORRECTED && row.defect === null) {
      problems.push(`corrected row has no defect record: ${row.id}`);
    }
    if (row.workflow === PENDING_REVIEW_WORKFLOW && row.caseIds.length === 0) {
      problems.push(`pending-review row names no case: ${row.id}`);
    }
    if (row.commandPath !== null) {
      const key = row.commandPath.join(COMMAND_SEPARATOR);
      rowCommands.set(key, (rowCommands.get(key) ?? 0) + 1);
    }
  }

  const known = new Set(commandPaths.map((path) => path.join(COMMAND_SEPARATOR)));
  for (const key of known) {
    const count = rowCommands.get(key) ?? 0;
    if (count === 0) problems.push(`missing cli row: ${key}`);
    if (count > 1) problems.push(`more than one cli row: ${key}`);
  }
  for (const key of rowCommands.keys()) {
    if (!known.has(key)) problems.push(`cli row for unknown command: ${key}`);
  }
  return problems;
}
