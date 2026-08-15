/**
 * @module CliDelegateProviderFactoryCodexTest
 * @path packages/ai-clidelegate/tests/cli_delegate_provider_factory_codex_test.ts
 * @related-files [packages/ai-clidelegate/src/cli_delegate_provider_factory.ts]
 * @architectural-layer AI
 * @description Phase 166 Step 3 — verifies CliDelegateProviderFactory resolves codex's
 * bin/default model the same way it already does for claude-code/opencode, and that the
 * three-way BIN_AND_MODEL_BY_TOOL lookup replacing the isClaude ternary left those two
 * tools' factory paths unchanged. `.id` (defaulting to `<tool>-<model>`) is the only
 * black-box signal CliDelegateProviderFactory exposes for verifying the resolved model —
 * `bin` itself is private on the constructed CliDelegateModelProvider and not independently
 * observable without spawning a real subprocess, the same limitation the pre-existing
 * claude-code/opencode factory tests already accept. Correct bin/model pairing per tool is
 * therefore verified by construction: BIN_AND_MODEL_BY_TOOL pairs each DEFAULT_*_CLI_BIN
 * with its matching DEFAULT_*_CLI_MODEL in the same object-literal entry.
 */

import { assertEquals } from "@std/assert";
import { CliDelegateProviderFactory } from "../src/cli_delegate_provider_factory.ts";
import type { CliDelegateModelProvider } from "../src/cli_delegate_model_provider.ts";
import { DEFAULT_CLAUDE_CLI_MODEL, DEFAULT_CODEX_CLI_MODEL, DEFAULT_OPENCODE_CLI_MODEL } from "../src/constants.ts";
import type { IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { ProviderType } from "@exaix/core";

Deno.test("CliDelegateProviderFactory: creates a codex provider with the requested model", async () => {
  const factory = new CliDelegateProviderFactory("codex");
  const provider = await factory.create({
    provider: ProviderType.ANTHROPIC,
    model: "gpt-5.6-terra",
    timeoutMs: 60000,
  } as IResolvedProviderOptions);

  const casted = provider as CliDelegateModelProvider;
  assertEquals(casted.id, "codex-gpt-5.6-terra");
});

Deno.test("CliDelegateProviderFactory: codex falls back to DEFAULT_CODEX_CLI_MODEL when options.model is empty", async () => {
  const factory = new CliDelegateProviderFactory("codex");
  const provider = await factory.create({
    provider: ProviderType.ANTHROPIC,
    model: "",
    timeoutMs: 60000,
  } as IResolvedProviderOptions);

  assertEquals((provider as CliDelegateModelProvider).id, `codex-${DEFAULT_CODEX_CLI_MODEL}`);
});

Deno.test("[regression] CliDelegateProviderFactory: claude-code/opencode factory paths are unchanged by the codex three-way lookup", async () => {
  const claudeFactory = new CliDelegateProviderFactory("claude-code");
  const claudeProvider = await claudeFactory.create({
    provider: ProviderType.ANTHROPIC,
    model: "",
    timeoutMs: 60000,
  } as IResolvedProviderOptions);
  assertEquals((claudeProvider as CliDelegateModelProvider).id, `claude-code-${DEFAULT_CLAUDE_CLI_MODEL}`);

  const opencodeFactory = new CliDelegateProviderFactory("opencode");
  const opencodeProvider = await opencodeFactory.create({
    provider: ProviderType.ANTHROPIC,
    model: "",
    timeoutMs: 60000,
  } as IResolvedProviderOptions);
  assertEquals((opencodeProvider as CliDelegateModelProvider).id, `opencode-${DEFAULT_OPENCODE_CLI_MODEL}`);
});
