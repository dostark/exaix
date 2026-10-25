/**
 * @module LintSettings
 * @path packages/schemas/src/lint_settings.ts
 * @description Resolves the effective verification.lint settings from the parsed config and Config DB overrides.
 * @architectural-layer Schemas
 * @dependencies [@exaix/core/types]
 * @related-files [packages/schemas/src/config.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";
import { type Config, type ILintSettings, LintSettingsSchema } from "./config.ts";

/** The settings prefix every registered lint key carries. */
export const LINT_SETTINGS_PREFIX = "verification.lint.";

/** Every registered lint setting key, in schema order. */
export const LINT_SETTING_KEYS: readonly string[] = [
  `${LINT_SETTINGS_PREFIX}findings_limit`,
  `${LINT_SETTINGS_PREFIX}json_max_bytes`,
  `${LINT_SETTINGS_PREFIX}stderr_max_bytes`,
  `${LINT_SETTINGS_PREFIX}batch_max_files`,
  `${LINT_SETTINGS_PREFIX}git_max_bytes`,
];

/** The override reader the resolver needs from the Config DB adapter. */
export interface ILintOverrideReader {
  getOverride?<T = unknown>(key: string): T | undefined;
}

type TSettingValue = string | number;

/** Resolves one validated settings record. A Config DB override wins over the TOML value. */
export function resolveLintSettings(
  config: Config,
  adapter: Opt<ILintOverrideReader, Reason.OptionalInput> = undefined,
): ILintSettings {
  const base: ILintSettings = config.verification.lint;
  if (adapter?.getOverride === undefined) return base;
  const merged: Record<string, TSettingValue> = { ...base };
  for (const key of LINT_SETTING_KEYS) {
    const override = adapter.getOverride<TSettingValue>(key);
    if (override === undefined || override === null) continue;
    merged[key.slice(LINT_SETTINGS_PREFIX.length)] = override;
  }
  const parsed = LintSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
}
