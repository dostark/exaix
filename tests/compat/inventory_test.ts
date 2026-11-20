/**
 * @module SoloInventoryTest
 * @path tests/compat/inventory_test.ts
 * @description Verifies the Solo compatibility inventory against the generated command tree.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  CANDIDATE_ROW_IDS,
  loadCommandPaths,
  loadInventory,
  parseInventory,
  PENDING_REVIEW_WORKFLOW,
  validateInventory,
} from "./harness/inventory.ts";
import { CompatCaseId } from "./harness/compat_types.ts";
import { InventoryDisposition } from "./harness/inventory_types.ts";
import type { IDefectRecord, ISoloInventory, ISoloInventoryRow, JsonValue } from "./harness/inventory_types.ts";

interface IRawRow {
  boundary?: string;
  disposition?: string;
}

interface IRawInventory {
  rows: IRawRow[];
}

const COMMAND_SEPARATOR = " ";

function commandKey(path: string[]): string {
  return path.join(COMMAND_SEPARATOR);
}

function withRows(inventory: ISoloInventory, rows: ISoloInventoryRow[]): ISoloInventory {
  return { ...inventory, rows };
}

function firstCommandRow(inventory: ISoloInventory): ISoloInventoryRow {
  const row = inventory.rows.find((candidate) => candidate.commandPath !== null);
  assert(row !== undefined, "the inventory has no command row");
  return row;
}

function pendingReviewRow(inventory: ISoloInventory): ISoloInventoryRow {
  const row = inventory.rows.find((candidate) => candidate.workflow === PENDING_REVIEW_WORKFLOW);
  assert(row !== undefined, "the inventory has no pending-review row");
  return row;
}

const SAMPLE_DEFECT: IDefectRecord = {
  minimalInput: "sample input",
  oldResult: "old",
  violatedRequirement: "requirement",
  correctedResult: "corrected",
  scriptEffect: "none",
  regression: "tests/compat/sample_test.ts",
};

Deno.test("inventory: every command path in exactl-cli.json has exactly one cli row", async () => {
  const inventory = await loadInventory();
  const paths = await loadCommandPaths();
  const rowKeys = inventory.rows
    .filter((row) => row.commandPath !== null)
    .map((row) => commandKey(row.commandPath ?? []));

  assertEquals(rowKeys.length, new Set(rowKeys).size, "a command path has more than one row");
  assertEquals([...rowKeys].sort(), paths.map(commandKey).sort());
  assertEquals(validateInventory(inventory, paths), []);
});

Deno.test("inventory: a removed command fails", async () => {
  const inventory = await loadInventory();
  const paths = await loadCommandPaths();
  const removed = paths[0];

  assertEquals(validateInventory(inventory, paths.slice(1)), [
    `cli row for unknown command: ${commandKey(removed)}`,
  ]);
});

Deno.test("inventory: a command without a row fails", async () => {
  const inventory = await loadInventory();
  const paths = await loadCommandPaths();
  const target = firstCommandRow(inventory);
  const rows = inventory.rows.filter((row) => row !== target);

  assertEquals(validateInventory(withRows(inventory, rows), paths), [
    `missing cli row: ${commandKey(target.commandPath ?? [])}`,
  ]);
});

Deno.test("inventory: a corrected row without a defect record fails", async () => {
  const inventory = await loadInventory();
  const paths = await loadCommandPaths();
  const target = firstCommandRow(inventory);
  const corrected: ISoloInventoryRow = { ...target, disposition: InventoryDisposition.CORRECTED, defect: null };
  const rows = inventory.rows.map((row) => (row === target ? corrected : row));

  assertEquals(validateInventory(withRows(inventory, rows), paths), [
    `corrected row has no defect record: ${target.id}`,
  ]);

  const withDefect: ISoloInventoryRow = { ...corrected, defect: SAMPLE_DEFECT };
  const fixed = inventory.rows.map((row) => (row === target ? withDefect : row));
  assertEquals(validateInventory(withRows(inventory, fixed), paths), []);
});

Deno.test("inventory: every pending-review row names a case ID", async () => {
  const inventory = await loadInventory();
  const paths = await loadCommandPaths();
  const target = pendingReviewRow(inventory);
  const unnamed: ISoloInventoryRow = { ...target, caseIds: [] };
  const rows = inventory.rows.map((row) => (row === target ? unnamed : row));

  assertEquals(validateInventory(withRows(inventory, rows), paths), [
    `pending-review row names no case: ${target.id}`,
  ]);

  const caseCount = inventory.rows.filter((row) => row.workflow === PENDING_REVIEW_WORKFLOW).length;
  assert(caseCount > 0, "the inventory has no pending-review rows");
  for (const caseId of Object.values(CompatCaseId)) {
    const named = inventory.rows.some((row) => row.caseIds.includes(caseId));
    assert(named, `no inventory row names case ${caseId}`);
  }
});

Deno.test("inventory: a duplicate row id fails", async () => {
  const inventory = await loadInventory();
  const paths = await loadCommandPaths();
  const target = firstCommandRow(inventory);
  const duplicate: ISoloInventoryRow = { ...pendingReviewRow(inventory), commandPath: null, id: target.id };
  const rows = [...inventory.rows, duplicate];

  assertEquals(validateInventory(withRows(inventory, rows), paths), [`duplicate row id: ${target.id}`]);
});

Deno.test("inventory: the three drafting candidates are recorded", async () => {
  const inventory = await loadInventory();
  const ids = new Set(inventory.rows.map((row) => row.id));

  assertEquals(CANDIDATE_ROW_IDS.length, 3);
  for (const id of CANDIDATE_ROW_IDS) {
    assert(ids.has(id), `candidate row ${id} is missing`);
  }
});

Deno.test("inventory: the daemon start row records its Deno dependency", async () => {
  const inventory = await loadInventory();
  const row = inventory.rows.find((candidate) => commandKey(candidate.commandPath ?? []) === "daemon start");
  assert(row !== undefined, "daemon start has no row");
  assertEquals(row.notes.some((note) => note.includes("deno run")), true);
});

Deno.test("inventory: parsing rejects an unknown boundary and a missing field", async () => {
  const inventory = await loadInventory();
  const mutated = (change: (row: IRawRow) => void): JsonValue => {
    const raw: IRawInventory = JSON.parse(JSON.stringify(inventory));
    change(raw.rows[0]);
    return JSON.parse(JSON.stringify(raw));
  };

  assertThrows(() => parseInventory(mutated((row) => row.boundary = "network")));
  assertThrows(() => parseInventory(mutated((row) => delete row.disposition)));
  assertEquals(parseInventory(mutated(() => undefined)).rows.length, inventory.rows.length);
});
