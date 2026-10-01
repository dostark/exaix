#!/usr/bin/env -S deno run -A
/**
 * @module ProviderCostsBudgetColumns
 * @path scripts/provider_costs_schema.ts
 * @description Adds the nullable service/transport identity columns to provider_costs
 *   when the consolidated initialization migration already applied, without rewriting
 *   existing rows. Mirrors scripts/activity_cache_schema.ts.
 * @architectural-layer Infrastructure
 * @dependencies [@db/sqlite]
 * @related-files [scripts/setup_db.ts, scripts/migrate_db.ts, migrations/001_init.sql]
 * Usage: imported by setup_db.ts and migrate_db.ts; not a standalone command.
 */

import type { Database } from "@db/sqlite";

interface IProviderCostColumn {
  name: string;
}

const PROVIDER_COSTS_IDENTITY_COLUMNS: readonly string[] = ["service", "transport"];

/** Runs only from explicit database setup/upgrade commands, outside their migration transactions. */
export function upgradeProviderCostsIdentityColumns(db: Database): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const columns: IProviderCostColumn[] = db.prepare("PRAGMA table_info(provider_costs)")
      .all() as IProviderCostColumn[];
    if (columns.length === 0) throw new Error("Cannot upgrade identity columns: provider_costs table is missing");
    const names: Set<string> = new Set(columns.map((column: IProviderCostColumn): string => column.name));
    for (const column of PROVIDER_COSTS_IDENTITY_COLUMNS) {
      if (!names.has(column)) db.exec(`ALTER TABLE provider_costs ADD COLUMN ${column} TEXT`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
