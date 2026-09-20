/**
 * @module CliDelegateProviderFactoryTest
 * @path packages/ai-clidelegate/tests/cli_delegate_provider_factory_test.ts
 * @related-files [packages/ai-clidelegate/src/cli_delegate_provider_factory.ts]
 * @architectural-layer AI
 * @description Verifies CliDelegateProviderFactory resolves the correct CLI binary/default
 * model per tool and threads resolved options through to the constructed provider.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { CliDelegateProviderFactory } from "../src/cli_delegate_provider_factory.ts";
import type { CliDelegateModelProvider } from "../src/cli_delegate_model_provider.ts";
import { DEFAULT_CLAUDE_CLI_MODEL, DEFAULT_OPENCODE_CLI_MODEL } from "../src/constants.ts";
import type { IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { ProviderType } from "@exaix/core";
import { ConfigSchema } from "@exaix/schemas";
import { SHELL_ONLY_TOOLS_PROTOCOL_BACKEND } from "../src/protocol_backend.ts";

function optionsFor(
  tool: "claude-code" | "codex" | "opencode",
  toolExposure?: "default" | "shell_only",
): IResolvedProviderOptions {
  return {
    provider: ProviderType.CLAUDE_CLI,
    model: "claude-sonnet-5",
    timeoutMs: 60000,
    config: ConfigSchema.parse({
      system: { root: Deno.cwd() },
      cli_delegate: { enabled: true, tool, ...(toolExposure ? { tool_exposure: toolExposure } : {}) },
    }),
  };
}

Deno.test("CliDelegateProviderFactory: shell-only policy is wired only for explicit Claude opt-in", async () => {
  const factory = new CliDelegateProviderFactory("claude-code");
  const shellProvider = await factory.create(optionsFor("claude-code", "shell_only"));
  assertEquals(Reflect.get(shellProvider, "options").protocolBackend, SHELL_ONLY_TOOLS_PROTOCOL_BACKEND);

  for (const tool of ["claude-code", "codex", "opencode"] as const) {
    const toolFactory = new CliDelegateProviderFactory(tool);
    const withoutConfig = await toolFactory.create({
      provider: ProviderType.CLAUDE_CLI,
      model: "claude-sonnet-5",
      timeoutMs: 60000,
    } as IResolvedProviderOptions);
    assertEquals(Reflect.get(withoutConfig, "options").protocolBackend, undefined);
    for (const exposure of [undefined, "default"] as const) {
      const provider = await toolFactory.create(optionsFor(tool, exposure));
      assertEquals(Reflect.get(provider, "options").protocolBackend, undefined);
    }
  }
});

Deno.test("CliDelegateProviderFactory: rejects shell-only configuration for unsupported tools", async () => {
  for (const tool of ["codex", "opencode"] as const) {
    const factory = new CliDelegateProviderFactory(tool);
    await assertRejects(() => factory.create(optionsFor(tool, "shell_only")), Error, "shell_only");
  }
});

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
