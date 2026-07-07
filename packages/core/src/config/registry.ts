/**
 * @module ConfigRegistry
 * @path packages/core/src/config/registry.ts
 * @description configurable() factory function and ConfigRegistry — registers
 *   tunable defaults at module evaluation time with metadata (type, min, max,
 *   enum, swap, edition). Exports getRegisteredDefaults() for lookup.
 * @architectural-layer Core
 * @related-files ["packages/core/src/config/errors.ts"]
 */
import type { ConfigValueType, SwapClass } from "../types/enums.ts";

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
}

export interface IRegisteredConfig {
  opts: IConfigurableOpts;
  registeredAt: Date;
}

const registry = new Map<string, IRegisteredConfig>();

export function configurable<T>(opts: IConfigurableOpts<T>): T {
  const strict = Deno.env.get("EXA_STRICT_CONFIG") === "1";
  if (strict && registry.has(opts.key)) {
    throw new Error(`Config key already registered: ${opts.key}`);
  }
  registry.set(opts.key, { opts, registeredAt: new Date() });
  return opts.default as T;
}

export function getRegisteredDefaults(): ReadonlyMap<string, IRegisteredConfig> {
  return registry;
}
