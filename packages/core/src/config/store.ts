/**
 * @module InMemoryConfigStore
 * @path packages/core/src/config/store.ts
 * @description The daemon's in-memory config cache — maps a config key to its live
 *   value and per-key SwapClass. Populated at daemon boot from the Config DB and
 *   updated by the Config DB watcher when hot-swappable keys change.
 * @architectural-layer Core
 * @dependencies ["@exaix/core/types/enums"]
 * @related-files ["packages/core/src/config/adapter.ts", "packages/core/src/config/db.ts"]
 */
import { SwapClass } from "../types/enums.ts";
import type { ConfigValue } from "./db.ts";

/** Each key carries its SwapClass so the watcher knows whether a change may be
 *  hot-applied. */
export class InMemoryConfigStore {
  private store = new Map<string, ConfigValue>();
  private swapClasses = new Map<string, SwapClass>();

  get<T extends ConfigValue = ConfigValue>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  set(key: string, value: ConfigValue, swap: SwapClass): void {
    this.store.set(key, value);
    this.swapClasses.set(key, swap);
  }

  delete(key: string): void {
    this.store.delete(key);
    this.swapClasses.delete(key);
  }

  entries(): Iterable<[string, ConfigValue]> {
    return this.store.entries();
  }

  getSwapClass(key: string): SwapClass {
    return this.swapClasses.get(key) ?? SwapClass.HOT;
  }
}
