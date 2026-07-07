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
import { SwapClass } from "../types/enums.ts";
import { getAllEffectiveValues } from "./db.ts";

/**
 * Create a handler function that hot-applies new Config DB overrides to
 * an InMemoryConfigStore. Designed to be called by a polling loop or
 * file-watcher callback.
 *
 * Only swap:hot keys are applied immediately. Restart-required keys are
 * skipped (they are already persisted in the DB and will be picked up on
 * the next daemon boot).
 */
export function createDbWatcherHandler(
  store: InMemoryConfigStore,
  db: Database,
  logger?: IEventLogger,
): () => Promise<void> {
  return async () => {
    const effective = getAllEffectiveValues(db);
    let changes = 0;
    for (const [key, value] of effective) {
      if (value === null) continue; // skip seed/init rows (no user override)
      const current = store.get(key);
      if (current !== value) {
        const swap = store.getSwapClass(key);
        if (swap === SwapClass.HOT) {
          store.set(key, value, swap);
          changes++;
        }
      }
    }
    if (changes > 0 && logger) {
      // Emit the purpose-built watcher event so a hot-apply triggered by an external
      // write is distinguishable in the journal from a direct CLI/adapter write
      // (which uses ConfigUpdated).
      await logger.info(DomainEventType.ConfigDbWatcherChangeDetected, "db_watcher", { changes });
    }
  };
}
