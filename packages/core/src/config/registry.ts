/**
 * @module ConfigRegistry
 * @path packages/core/src/config/registry.ts
 * @description configurable() factory function and ConfigRegistry — registers
 *   tunable defaults at module evaluation time with metadata (type, min, max,
 *   enum, swap, edition). Exports getRegisteredDefaults() for lookup.
 * @architectural-layer Core
 * @related-files ["packages/core/src/config/errors.ts"]
 */
import { SwapClass } from "../types/enums.ts";
import type { ConfigValueType } from "../types/enums.ts";
import type { ConfigValue } from "./db.ts";

/** MCP authorization tier for a configurable key: `safe` auto-approves MCP writes,
 *  `leaf` requires human approval, `dangerous` requires approval + confirmation marker. */
export type ConfigTier = "safe" | "leaf" | "dangerous";

export interface IConfigurableOpts<T = unknown> {
  key: string;
  default: T;
  type: ConfigValueType;
  description: string;
  min?: number;
  max?: number;
  enum?: readonly (string | number)[];
  swap?: SwapClass;
  edition?: readonly string[];
  /** When set, {@link resolveTier} returns it verbatim instead of deriving from
   *  `swap`/`edition` — use only for a rare no-impact `swap: "hot"` key that should
   *  auto-approve (e.g. `ui.theme`). */
  tier?: ConfigTier;
}

export interface IRegisteredConfig {
  opts: IConfigurableOpts;
  registeredAt: Date;
}

const registry = new Map<string, IRegisteredConfig>();

export function configurable<T>(opts: IConfigurableOpts<T>): T {
  let strict = false;
  try {
    strict = Deno.env.get("EXA_STRICT_CONFIG") === "1";
  } catch {
    // Permission denied for env access — default to non-strict.
  }
  if (strict && registry.has(opts.key)) {
    throw new Error(`Config key already registered: ${opts.key}`);
  }
  registry.set(opts.key, { opts, registeredAt: new Date() });
  return opts.default as T;
}

export function getRegisteredDefaults(): ReadonlyMap<string, IRegisteredConfig> {
  return registry;
}

/** The own-portal `"safe"` auto-approve tier is deferred until the MCP tool has
 *  own-portal context; `"safe"` is reachable today only via an explicit override. */
export function resolveTier(key: string): ConfigTier {
  const entry = registry.get(key);
  if (!entry) return "leaf";
  const { tier, swap, edition } = entry.opts;
  if (tier) return tier;
  if (swap === SwapClass.RESTART) return "dangerous";
  if (edition?.includes("team")) return "dangerous";
  return "leaf";
}

/** Returns undefined fields when the key is not registered or the field was not
 *  specified. Callers should cast `default` to the expected type. */
export function resolveConfigurableBounds(key: string): {
  min?: number;
  max?: number;
  default: ConfigValue | undefined;
} {
  const entry = registry.get(key);
  if (!entry) return { default: undefined };
  const defaultValue = entry.opts.default as ConfigValue;
  return { min: entry.opts.min, max: entry.opts.max, default: defaultValue };
}
