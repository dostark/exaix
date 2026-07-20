/**
 * @module CliDelegatePackageConstants
 * @path packages/ai-clidelegate/src/constants.ts
 * @related-files []
 * @description Headless-CLI (claude/opencode) provider defaults and metadata owned by
 *   @exaix/ai-clidelegate. Both tools are subscription/flat-rate billed — no metered
 *   API key is ever forwarded to the spawned subprocess (see buildDelegateEnv).
 * @architectural-layer AI
 */

import { configurable } from "@exaix/core/config";
import { ConfigValueType, SwapClass } from "@exaix/core";
import { type IProviderDefaults, ProviderCostTier, ProviderType } from "@exaix/core";

export const DEFAULT_CLAUDE_CLI_MODEL: string = configurable({
  key: "claude_cli.model",
  default: "claude-sonnet-5",
  type: ConfigValueType.STRING,
  description: "Default model identifier for the headless claude-cli provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_OPENCODE_CLI_MODEL: string = configurable({
  key: "opencode_cli.model",
  default: "opencode/deepseek-v4-flash-free",
  type: ConfigValueType.STRING,
  description: "Default model identifier for the headless opencode-cli provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_CLI_DELEGATE_TIMEOUT_MS: number = configurable({
  key: "cli_delegate_provider.timeout_ms",
  default: 300_000,
  type: ConfigValueType.NUMBER,
  description: "Subprocess timeout in milliseconds for the headless claude-cli/opencode-cli providers",
  min: 1000,
  max: 900_000,
  swap: SwapClass.HOT,
});

/** IProviderDefaults.defaultEndpoint has no HTTP-endpoint meaning for a subprocess-spawned
 * provider — repurposed as the bare CLI binary name SafeSubprocess.run spawns. */
export const DEFAULT_CLAUDE_CLI_BIN = "claude";
export const DEFAULT_OPENCODE_CLI_BIN = "opencode";

export const PROVIDER_CLAUDE_CLI = ProviderType.CLAUDE_CLI;
export const PROVIDER_OPENCODE_CLI = ProviderType.OPENCODE_CLI;

export const PROVIDER_CLAUDE_CLI_DESCRIPTION =
  "Headless Claude Code CLI, billed against a Claude Pro/Max subscription (no metered API key)";
export const PROVIDER_OPENCODE_CLI_DESCRIPTION =
  "Headless opencode CLI, billed at the configured model's flat/subscription rate (no metered API key)";
export const PROVIDER_CLI_DELEGATE_CAPABILITIES = ["chat"] as const;
export const PROVIDER_CLI_DELEGATE_STRENGTHS = ["subscription-billed", "no-api-key"] as const;
export const PROVIDER_CLI_DELEGATE_COST_TIER = ProviderCostTier.FREE;

export const CLAUDE_CLI_PROVIDER_METADATA = {
  name: PROVIDER_CLAUDE_CLI,
  description: PROVIDER_CLAUDE_CLI_DESCRIPTION,
  capabilities: PROVIDER_CLI_DELEGATE_CAPABILITIES,
  costTier: PROVIDER_CLI_DELEGATE_COST_TIER,
  strengths: PROVIDER_CLI_DELEGATE_STRENGTHS,
} as const;

export const OPENCODE_CLI_PROVIDER_METADATA = {
  name: PROVIDER_OPENCODE_CLI,
  description: PROVIDER_OPENCODE_CLI_DESCRIPTION,
  capabilities: PROVIDER_CLI_DELEGATE_CAPABILITIES,
  costTier: PROVIDER_CLI_DELEGATE_COST_TIER,
  strengths: PROVIDER_CLI_DELEGATE_STRENGTHS,
} as const;

export const CLAUDE_CLI_DEFAULTS: IProviderDefaults = {
  defaultModel: DEFAULT_CLAUDE_CLI_MODEL,
  defaultEndpoint: DEFAULT_CLAUDE_CLI_BIN,
  defaultTimeoutMs: DEFAULT_CLI_DELEGATE_TIMEOUT_MS,
  defaultRetryMaxAttempts: 1,
  defaultRetryBackoffMs: 0,
};

export const OPENCODE_CLI_DEFAULTS: IProviderDefaults = {
  defaultModel: DEFAULT_OPENCODE_CLI_MODEL,
  defaultEndpoint: DEFAULT_OPENCODE_CLI_BIN,
  defaultTimeoutMs: DEFAULT_CLI_DELEGATE_TIMEOUT_MS,
  defaultRetryMaxAttempts: 1,
  defaultRetryBackoffMs: 0,
};
