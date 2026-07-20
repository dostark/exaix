/**
 * @module AiClidelegatePackageSurfaceTest
 * @path packages/ai-clidelegate/tests/ai_clidelegate_package_surface_test.ts
 * @related-files []
 * @architectural-layer AI
 * @description Verifies the public @exaix/ai-clidelegate package surface.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  CLAUDE_CLI_DEFAULTS,
  CLAUDE_CLI_PROVIDER_METADATA,
  CliDelegateModelProvider,
  CliDelegateProviderFactory,
  DEFAULT_CLAUDE_CLI_MODEL,
  OPENCODE_CLI_DEFAULTS,
  OPENCODE_CLI_PROVIDER_METADATA,
} from "../mod.ts";

Deno.test("@exaix/ai-clidelegate exports provider, factory, and constants", () => {
  assertExists(CliDelegateModelProvider);
  assertExists(CliDelegateProviderFactory);
  assertExists(CLAUDE_CLI_PROVIDER_METADATA);
  assertExists(OPENCODE_CLI_PROVIDER_METADATA);
  assertExists(CLAUDE_CLI_DEFAULTS);
  assertExists(OPENCODE_CLI_DEFAULTS);
});

Deno.test("CliDelegateModelProvider constructs with defaults from package surface", () => {
  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: DEFAULT_CLAUDE_CLI_MODEL,
    cwd: "/tmp",
  });

  assertEquals(provider.id, `claude-code-${DEFAULT_CLAUDE_CLI_MODEL}`);
});
