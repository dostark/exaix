/**
 * @module CliDelegateProviderFactoryTest
 * @path packages/ai-clidelegate/tests/cli_delegate_provider_factory_test.ts
 * @related-files [packages/ai-clidelegate/src/cli_delegate_provider_factory.ts]
 * @architectural-layer AI
 * @description Verifies CliDelegateProviderFactory resolves the correct CLI binary/default
 * model per tool and threads resolved options through to the constructed provider.
 */

import { assertEquals } from "@std/assert";
import { CliDelegateProviderFactory } from "../src/cli_delegate_provider_factory.ts";
import type { CliDelegateModelProvider } from "../src/cli_delegate_model_provider.ts";
import { DEFAULT_CLAUDE_CLI_MODEL, DEFAULT_OPENCODE_CLI_MODEL } from "../src/constants.ts";
import type { IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { ProviderType } from "@exaix/core";

Deno.test("CliDelegateProviderFactory: creates a claude-code provider with the requested model", async () => {
  const factory = new CliDelegateProviderFactory("claude-code");
  const provider = await factory.create({
    provider: ProviderType.ANTHROPIC,
    model: "claude-sonnet-5",
    timeoutMs: 60000,
  } as IResolvedProviderOptions);

  const casted = provider as CliDelegateModelProvider;
  assertEquals(casted.id, "claude-code-claude-sonnet-5");
});

Deno.test("CliDelegateProviderFactory: creates an opencode provider with the requested model", async () => {
  const factory = new CliDelegateProviderFactory("opencode");
  const provider = await factory.create({
    provider: ProviderType.ANTHROPIC,
    model: "opencode/deepseek-v4-flash-free",
    timeoutMs: 60000,
  } as IResolvedProviderOptions);

  const casted = provider as CliDelegateModelProvider;
  assertEquals(casted.id, "opencode-opencode/deepseek-v4-flash-free");
});

Deno.test("CliDelegateProviderFactory: strips a provider-prefixed model before constructing the provider", async () => {
  // options.model may arrive "provider:model"-prefixed; claude/codex/opencode reject that on
  // --model with a 404 (live-verified). Ollama's colon-tag models never reach this factory.
  const factory = new CliDelegateProviderFactory("claude-code");
  const provider = await factory.create({
    provider: ProviderType.CLAUDE_CLI,
    model: "claude-cli:claude-sonnet-5",
    timeoutMs: 60000,
  } as IResolvedProviderOptions);

  const casted = provider as CliDelegateModelProvider;
  assertEquals(casted.id, "claude-code-claude-sonnet-5");
});

Deno.test("CliDelegateProviderFactory: strips a provider-prefixed model for the codex tool too", async () => {
  const factory = new CliDelegateProviderFactory("codex");
  const provider = await factory.create({
    provider: ProviderType.CODEX_CLI,
    model: "codex-cli:gpt-5.6-sol",
    timeoutMs: 60000,
  } as IResolvedProviderOptions);

  const casted = provider as CliDelegateModelProvider;
  assertEquals(casted.id, "codex-gpt-5.6-sol");
});

Deno.test("CliDelegateProviderFactory: falls back to the tool's default model when options.model is empty", async () => {
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
