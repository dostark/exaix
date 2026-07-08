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

/**
 * MCP three-tier authorization classification for a configurable key.
 * - `"safe"`      — no security impact; MCP writes are auto-approved.
 * - `"leaf"`      — tunable, affects behaviour; MCP writes require human approval.
 * - `"dangerous"` — security-critical/destructive; approval + confirmation marker.
 */
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
  /**
   * Optional explicit MCP authorization tier override (Phase 138). When set,
   * {@link resolveTier} returns it verbatim; otherwise the tier is derived from
   * `swap`/`edition`. Use only for the rare no-impact `swap: "hot"` key (e.g.
   * `ui.theme`) that should auto-approve.
   */
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

/**
 * Resolve the MCP three-tier authorization tier for a registered config key
 * (Phase 138 Step 1). Precedence:
 * 1. explicit `tier` override on the opts → returned verbatim;
 * 2. `swap === RESTART` or `edition` includes `"team"` → `"dangerous"`;
 * 3. otherwise → `"leaf"` (the common `swap: "hot"` / unregistered case).
 *
 * The own-portal `"safe"` auto-approve tier from design §11.3 is deferred to a
 * future phase (the MCP tool has no own-portal context today); `"safe"` is
 * reachable this phase only via an explicit `tier: "safe"` override.
 */
export function resolveTier(key: string): ConfigTier {
  const entry = registry.get(key);
  if (!entry) return "leaf";
  const { tier, swap, edition } = entry.opts;
  if (tier) return tier;
  if (swap === SwapClass.RESTART) return "dangerous";
  if (edition?.includes("team")) return "dangerous";
  return "leaf";
}

/**
 * Retrieve the min/max/default bounds for a registered configurable key.
 * Returns undefined fields when the key is not registered or the field
 * was not specified. Callers should cast `default` to the expected type.
 */
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
