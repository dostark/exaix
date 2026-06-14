#!/usr/bin/env -S deno run -A

/**
 * @module LedgerGate
 * @path scripts/ledger_gate.ts
 * Usage: deno run -A scripts/ledger_gate.ts
 * @description Scans the Phase 115 Reachability Ledger table in
 * exaix-dev-docs/planning/phase-115-edition-rollout-roadmap.md for any ⏳
 * status cells. Fails if any remain. Phase 115 Step 9c.
 *
 * The ledger table has columns: Symbol | Added in | Wiring step | Production call-site | Status
 * Only the Status column (last cell) matters. We detect table rows starting
 * with `|` where the last non-whitespace cell before the closing `|` is `⏳`.
 */

const LEDGER_FILE = "exaix-dev-docs/planning/phase-115-edition-rollout-roadmap.md";

let content: string;
try {
  content = await Deno.readTextFile(LEDGER_FILE);
} catch {
  console.error(`⚠️  Ledger file not found at ${LEDGER_FILE} — skipping check.`);
  Deno.exit(0);
}

const lines = content.split("\n");
const openRows: { line: number; symbol: string }[] = [];
let inLedger = false;
let seenTableRows = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  if (line.includes("Reachability Ledger")) {
    inLedger = true;
    continue;
  }

  if (!inLedger) continue;

  // Empty line after table rows ends the ledger section
  if (seenTableRows && line.trim() === "") break;

  // Skip non-table lines
  if (!line.startsWith("|")) continue;
  if (line.includes("---") || line.includes("Symbol")) continue;

  // Table data row — extract status from second-to-last cell
  seenTableRows = true;
  const cells = line.split("|").map((c) => c.trim());
  const lastCell = cells[cells.length - 2]; // second-to-last due to leading/trailing |
  if (lastCell && lastCell.trim() === "⏳") {
    // Symbol is the second cell (index 1) — first is empty due to leading |
    const symbol = cells[1] ? cells[1].replace(/`/g, "").trim() : "unknown";
    openRows.push({ line: i + 1, symbol: symbol.trim() });
  }
}

if (openRows.length > 0) {
  console.error(`❌ Reachability Ledger has ${openRows.length} ⏳ symbol(s):`);
  for (const row of openRows) {
    console.error(`   ${row.symbol} (${LEDGER_FILE}:${row.line})`);
  }
  console.error("\nThe phase cannot close until all ledger symbols are ✅.");
  Deno.exit(1);
}

console.log("✅ Reachability Ledger: all rows ✅ — phase is ready to close.");
