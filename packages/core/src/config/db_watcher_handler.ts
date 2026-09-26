/**
 * @module ConfigDbWatcherHandler
 * @path packages/core/src/config/db_watcher_handler.ts
 * @description Polling-based Config DB watcher that detects new overrides
 *   via MAX(id) change and hot-applies swap:hot keys to the in-memory store.
 * @architectural-layer Core
 * @dependencies ["@exaix/core/config/store", "@exaix/core/config/db", "@exaix/core/logger", "@exaix/core/events"]
 * @related-files ["packages/core/src/config/store.ts", "packages/core/src/config/db.ts"]
 */
import type { InMemoryConfigStore } from "./store.ts";
import type { Database } from "@db/sqlite";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { ConfigValueType, SwapClass } from "../types/enums.ts";
import type { Opt, Reason } from "../types/optional_marker.ts";
import { CONFIG_SOURCE_INIT, getAllEffectiveValues } from "./db.ts";
import { CONFIG_CHECKSUM_KEY } from "../types/constants.ts";
import { getRegisteredDefaults } from "./registry.ts";

function typedOverride(key: string, value: string | number | boolean): string | number | boolean {
  if (typeof value !== "string") return value;
  const type = getRegisteredDefaults().get(key)?.opts.type;
  if (type === ConfigValueType.BOOLEAN) return value === "true";
  if (type === ConfigValueType.NUMBER) {
    const numberValue = Number(value);
    return Number.isNaN(numberValue) ? value : numberValue;
  }
  return value;
}

/** Hot-applies new Config DB overrides to an InMemoryConfigStore from a polling/file-watcher loop. Only swap:hot keys apply immediately; restart-required keys already persist in the DB and load on the next daemon boot. */
export function createDbWatcherHandler(
  store: InMemoryConfigStore,
  db: Database,
  logger?: Opt<IEventLogger, Reason.OptionalDependency>,
): () => Promise<void> {
  return async () => {
    const effective = getAllEffectiveValues(db);
    const sources = new Map(
      db.prepare(
        "SELECT key, source FROM config_overrides WHERE id IN (SELECT MAX(id) FROM config_overrides GROUP BY key)",
      ).all<{ key: string; source: string }>().map((row) => [row.key, row.source]),
    );
    let changes = 0;
    const changedValues: Array<{ key: string; value: string | number | boolean | null }> = [];
    for (const [key, value] of effective) {
      // The synthetic integrity checksum refreshes on every write; it is not a user
      // override and must not trigger a hot-apply or a spurious ConfigDbWatcherChangeDetected.
      if (key === CONFIG_CHECKSUM_KEY) continue;
      const current = store.get(key);
      if (value === null) {
        // Clearing an override must reveal the config/TOML fallback on the next read.
        // Seed/init NULL rows do not count as changes because they have no cached value.
        if (
          sources.get(key) !== CONFIG_SOURCE_INIT && current !== undefined && current !== null &&
          store.getSwapClass(key) === SwapClass.HOT
        ) {
          store.delete(key);
          changes++;
          changedValues.push({ key, value: null });
        }
        continue;
      }
      if (current !== value) {
        const swap = store.getSwapClass(key);
        if (swap === SwapClass.HOT) {
          store.set(key, value, swap);
          changes++;
          changedValues.push({ key, value: typedOverride(key, value) });
        }
      }
    }
    if (changes > 0 && logger) {
      for (const { key, value } of changedValues) {
        await logger.info(DomainEventType.ConfigUpdated, key, {
          value,
          source: "config_db_watcher",
          swap_class: store.getSwapClass(key),
        });
      }
      // Emit the purpose-built watcher event so a hot-apply triggered by an external
      // write is distinguishable from the per-key ConfigUpdated events.
      await logger.info(DomainEventType.ConfigDbWatcherChangeDetected, "db_watcher", { changes });
    }
  };
}
