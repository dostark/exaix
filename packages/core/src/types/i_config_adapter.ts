/**
 * @module IConfigAdapter
 * @path packages/core/src/types/i_config_adapter.ts
 * @description Lightweight IConfigAdapter interface stub for use in IApplicationContext.
 *   Only exposes get() and mode — avoids importing the full @exaix/core/config module
 *   into the types layer to prevent circular dependencies. The full interface with
 *   set/unset/listOverrides/etc. lives at @exaix/core/config/adapter.ts.
 * @architectural-layer Shared/Interfaces
 * @related-files ["packages/core/src/types/i_application_context.ts"]
 */
import type { ConfigAdapterMode } from "./enums.ts";

export interface IConfigAdapter {
  /** Read effective value: Config DB override → registry default. */
  get<T = unknown>(key: string): T | undefined;
  /** Whether the adapter is in direct (offline) or daemon mode. */
  readonly mode: ConfigAdapterMode;
}
