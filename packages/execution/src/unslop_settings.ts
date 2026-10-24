/**
 * @module UnslopSettings
 * @path packages/execution/src/unslop_settings.ts
 * @description Resolves the effective portal unslop settings from the parsed config, TOML values,
 *   validated Config DB overrides and the registered defaults.
 * @architectural-layer Services
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/execution/src/execution_loop.ts, packages/schemas/src/config.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";
import type { Config, IUnslopSettings } from "@exaix/schemas";
import { UnslopSettingsSchema } from "@exaix/schemas/config.ts";

/** The settings prefix every registered key carries. */
const UNSLOP_SETTINGS_PREFIX = "verification.unslop.";

/** Every registered unslop setting key, in schema order. */
export const UNSLOP_SETTING_KEYS: readonly string[] = [
  `${UNSLOP_SETTINGS_PREFIX}asset_dir`,
  `${UNSLOP_SETTINGS_PREFIX}findings_limit`,
  `${UNSLOP_SETTINGS_PREFIX}json_max_bytes`,
  `${UNSLOP_SETTINGS_PREFIX}stderr_max_bytes`,
  `${UNSLOP_SETTINGS_PREFIX}candidate_max_count`,
  `${UNSLOP_SETTINGS_PREFIX}file_max_bytes`,
  `${UNSLOP_SETTINGS_PREFIX}catalog_max_bytes`,
  `${UNSLOP_SETTINGS_PREFIX}git_max_bytes`,
  `${UNSLOP_SETTINGS_PREFIX}batch_max_files`,
  `${UNSLOP_SETTINGS_PREFIX}argv_max_bytes`,
];

type TSettingValue = string | number;

/** The override reader the resolver needs from the Config DB adapter. */
export interface IUnslopOverrideReader {
  getOverride?<T = unknown>(key: string): T | undefined;
}

/** Resolves one validated settings record. A Config DB override wins over the TOML value. */
export function resolveUnslopSettings(
  config: Config,
  adapter: Opt<IUnslopOverrideReader, Reason.OptionalInput>,
): IUnslopSettings {
  const base: IUnslopSettings = config.verification.unslop;
  if (adapter?.getOverride === undefined) return base;
  const merged: Record<string, TSettingValue> = { ...base };
  for (const key of UNSLOP_SETTING_KEYS) {
    const override = adapter.getOverride<TSettingValue>(key);
    if (override === undefined || override === null) continue;
    merged[key.slice(UNSLOP_SETTINGS_PREFIX.length)] = override;
  }
  const parsed = UnslopSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
}
