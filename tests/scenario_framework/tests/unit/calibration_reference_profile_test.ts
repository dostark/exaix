/**
 * @module CalibrationReferenceProfileTest
 * @path tests/scenario_framework/tests/unit/calibration_reference_profile_test.ts
 * @description Verify the isolated CLI launcher profile: provider-to-transport mapping,
 *   model prefix handling and the hashed empty-root runtime manifest the sandbox mounts.
 *   The live provider call itself is exercised by the opt-in sandbox security legs.
 * @architectural-layer Test
 * @dependencies @std/assert, @exaix/core
 * @related-files [tests/scenario_framework/runner/calibration_sandbox.ts]
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  CalibrationSandboxCli,
  resolveCliRuntimeManifest,
  resolveSandboxCli,
  stripProviderPrefix,
} from "../../runner/calibration_sandbox.ts";

Deno.test("[CalibrationReferenceProfile] resolves a sandbox profile only for the two supported CLI transports", () => {
  assertEquals(resolveSandboxCli("claude-cli"), CalibrationSandboxCli.Claude);
  assertEquals(resolveSandboxCli("codex-cli"), CalibrationSandboxCli.Codex);
  for (const provider of ["anthropic", "openai", "ollama", "opencode-cli"]) {
    assertThrows(() => resolveSandboxCli(provider), Error, "no sandbox profile");
  }
});

Deno.test("[CalibrationReferenceProfile] strips a transport prefix before the model reaches the CLI argv", () => {
  assertEquals(stripProviderPrefix("claude-cli:claude-sonnet-5"), "claude-sonnet-5");
  assertEquals(stripProviderPrefix("codex-cli:gpt-5.6-sol"), "gpt-5.6-sol");
  assertEquals(stripProviderPrefix("claude-sonnet-5"), "claude-sonnet-5");
});

Deno.test({
  name: "[CalibrationReferenceProfile] the empty-root runtime manifest is a hashed file allowlist plus one auth file",
  ignore: Deno.env.get("CI") === "true",
  fn: async () => {
    const manifest = await resolveCliRuntimeManifest(CalibrationSandboxCli.Claude);
    assert(manifest.files.length >= 1, "the CLI binary itself is always an allowlisted file");
    for (const file of manifest.files) {
      assert(file.path.startsWith("/"), `runtime file must be absolute: ${file.path}`);
      assertEquals(file.sha256.length, 64, `runtime file must carry a sha256 digest: ${file.path}`);
    }
    assertStringIncludes(manifest.authFile, ".claude/.credentials.json");
  },
});
