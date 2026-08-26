/**
 * @module CliDelegatePackageConstants
 * @path packages/ai-clidelegate/src/constants.ts
 * @related-files []
 * @description Headless-CLI (claude/opencode/codex) provider defaults and metadata owned by
 *   @exaix/ai-clidelegate. All three tools are subscription/flat-rate billed — no metered
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
/**
 * **[Corrected post-implementation, 2026-08-15]** The original "gpt-5.2-codex" choice was
 * WRONG: a live `codex exec --model gpt-5.2-codex` call against a real ChatGPT-account
 * session returned `HTTP 400 "The 'gpt-5.2-codex' model is not supported when using Codex
 * with a ChatGPT account."` The `-codex`-suffixed family (gpt-5.1-codex-max, gpt-5.2-codex,
 * gpt-5.3-codex) is API-key-billed only (OpenAI's Responses API) and deprecated for
 * ChatGPT-account sign-in — the `~/.codex/config.toml` migration notice this constant was
 * originally justified from ("gpt-5.1-codex-max" -> "gpt-5.2-codex") tracks that API-side
 * rename, not a ChatGPT-account-compatible model. The current, ChatGPT-account-compatible
 * family, confirmed live (2026-08-15) against `learn.chatgpt.com/docs/models`, is
 * gpt-5.6-{sol,terra,luna}. "gpt-5.6-terra" — "the pragmatic all-rounder... a natural
 * starting point for work you previously gave GPT-5.5" — matches this environment's own
 * `~/.codex/config.toml` operator default and Exaix's existing convention of a balanced,
 * not flagship, per-tool default (mirrors DEFAULT_CLAUDE_CLI_MODEL's "claude-sonnet-5").
 */
export const DEFAULT_CODEX_CLI_MODEL: string = configurable({
  key: "codex_cli.model",
  default: "gpt-5.6-terra",
  type: ConfigValueType.STRING,
  description: "Default model identifier for the headless codex-cli provider",
  swap: SwapClass.RESTART,
});
export const DEFAULT_CLI_DELEGATE_TIMEOUT_MS: number = configurable({
  key: "cli_delegate_provider.timeout_ms",
  default: 300_000,
  type: ConfigValueType.NUMBER,
  description: "Subprocess timeout in milliseconds for the headless claude-cli/opencode-cli/codex-cli providers",
  min: 1000,
  max: 900_000,
  swap: SwapClass.HOT,
});

/** IProviderDefaults.defaultEndpoint has no HTTP-endpoint meaning for a subprocess-spawned
 * provider — repurposed as the bare CLI binary name SafeSubprocess.run spawns. */
export const DEFAULT_CLAUDE_CLI_BIN = "claude";
export const DEFAULT_OPENCODE_CLI_BIN = "opencode";
export const DEFAULT_CODEX_CLI_BIN = "codex";

export const PROVIDER_CLAUDE_CLI = ProviderType.CLAUDE_CLI;
export const PROVIDER_OPENCODE_CLI = ProviderType.OPENCODE_CLI;
export const PROVIDER_CODEX_CLI = ProviderType.CODEX_CLI;

export const PROVIDER_CLAUDE_CLI_DESCRIPTION =
  "Headless Claude Code CLI, billed against a Claude Pro/Max subscription (no metered API key)";
export const PROVIDER_OPENCODE_CLI_DESCRIPTION =
  "Headless opencode CLI, billed at the configured model's flat/subscription rate (no metered API key)";
export const PROVIDER_CODEX_CLI_DESCRIPTION =
  "Headless Codex CLI, billed against a ChatGPT Codex subscription (no metered API key)";
export const PROVIDER_CLI_DELEGATE_CAPABILITIES = ["chat"] as const;
export const PROVIDER_CLI_DELEGATE_STRENGTHS = ["subscription-billed", "no-api-key"] as const;
export const PROVIDER_CLI_DELEGATE_COST_TIER = ProviderCostTier.FREE;

/** Phase 132 capability metadata — headless CLI agents carry large native context windows. */
export const CLI_DELEGATE_CONTEXT_WINDOW = 200_000;
/** Phase 132 capability metadata — subscription-billed subprocess, no metered per-token cost. */
export const CLI_DELEGATE_COST_PER_MTok = 0;

export const CLAUDE_CLI_PROVIDER_METADATA = {
  name: PROVIDER_CLAUDE_CLI,
  description: PROVIDER_CLAUDE_CLI_DESCRIPTION,
  capabilities: PROVIDER_CLI_DELEGATE_CAPABILITIES,
  costTier: PROVIDER_CLI_DELEGATE_COST_TIER,
  strengths: PROVIDER_CLI_DELEGATE_STRENGTHS,
  supportsThinking: false,
  supportsEffort: false,
  contextWindow: CLI_DELEGATE_CONTEXT_WINDOW,
  costPerMtok: CLI_DELEGATE_COST_PER_MTok,
} as const;

export const OPENCODE_CLI_PROVIDER_METADATA = {
  name: PROVIDER_OPENCODE_CLI,
  description: PROVIDER_OPENCODE_CLI_DESCRIPTION,
  capabilities: PROVIDER_CLI_DELEGATE_CAPABILITIES,
  costTier: PROVIDER_CLI_DELEGATE_COST_TIER,
  strengths: PROVIDER_CLI_DELEGATE_STRENGTHS,
  supportsThinking: false,
  supportsEffort: false,
  contextWindow: CLI_DELEGATE_CONTEXT_WINDOW,
  costPerMtok: CLI_DELEGATE_COST_PER_MTok,
} as const;

export const CODEX_CLI_PROVIDER_METADATA = {
  name: PROVIDER_CODEX_CLI,
  description: PROVIDER_CODEX_CLI_DESCRIPTION,
  capabilities: PROVIDER_CLI_DELEGATE_CAPABILITIES,
  costTier: PROVIDER_CLI_DELEGATE_COST_TIER,
  strengths: PROVIDER_CLI_DELEGATE_STRENGTHS,
  supportsThinking: false,
  supportsEffort: false,
  contextWindow: CLI_DELEGATE_CONTEXT_WINDOW,
  costPerMtok: CLI_DELEGATE_COST_PER_MTok,
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

export const CODEX_CLI_DEFAULTS: IProviderDefaults = {
  defaultModel: DEFAULT_CODEX_CLI_MODEL,
  defaultEndpoint: DEFAULT_CODEX_CLI_BIN,
  defaultTimeoutMs: DEFAULT_CLI_DELEGATE_TIMEOUT_MS,
  defaultRetryMaxAttempts: 1,
  defaultRetryBackoffMs: 0,
};
