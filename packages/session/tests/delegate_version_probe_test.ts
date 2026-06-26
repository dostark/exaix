/**
 * @module DelegateVersionProbeTest
 * @path packages/session/tests/delegate_version_probe_test.ts
 * @description Phase 128 Step 1 — tests for the delegate-version probe helper:
 *   semver parsing, minimum-version comparison, and below-minimum warning
 *   (non-blocking). Uses mock `Deno.Command` via the injectable spawn seam so
 *   tests are deterministic and do not require real binaries.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";

import {
  type IDelegateVersionProbeDeps,
  type IDelegateVersionResult,
  probeDelegateVersion,
} from "@exaix/session/delegate_version_probe.ts";
import {
  MINIMUM_VERSION_CLAUDE_CODE,
  MINIMUM_VERSION_OPENCODE,
  SESSION_BIN_CLAUDE_CODE,
  SESSION_BIN_OPENCODE,
} from "@exaix/core/types";

/** Build minimal probe deps that return a given stdout from `<bin> --version`. */
function mockProbeDeps(stdout: string, exitCode = 0): IDelegateVersionProbeDeps {
  return {
    spawnVersion: (_bin: string) =>
      Promise.resolve({
        success: exitCode === 0,
        stdout: new TextEncoder().encode(stdout),
        stderr: new Uint8Array(),
      }),
  };
}

Deno.test("[delegate_version] probe parses opencode --version and compares to minimum", async () => {
  const result = await probeDelegateVersion(
    SESSION_BIN_OPENCODE,
    MINIMUM_VERSION_OPENCODE,
    mockProbeDeps("1.16.2\n"),
  );
  assertEquals(result.supported, true);
  assertEquals(result.version, "1.16.2");
  assertEquals(result.warning, undefined);
});

Deno.test("[delegate_version] probe parses claude --version and compares to minimum", async () => {
  const result = await probeDelegateVersion(
    SESSION_BIN_CLAUDE_CODE,
    MINIMUM_VERSION_CLAUDE_CODE,
    mockProbeDeps("2.1.150 (Claude Code)\n"),
  );
  assertEquals(result.supported, true);
  assertEquals(result.version, "2.1.150");
  assertEquals(result.warning, undefined);
});

Deno.test("[delegate_version] below-minimum version warns with remediation, does not throw", async () => {
  const result = await probeDelegateVersion(
    SESSION_BIN_OPENCODE,
    MINIMUM_VERSION_OPENCODE,
    mockProbeDeps("0.9.0\n"),
  );
  assertEquals(result.supported, false);
  assertEquals(result.version, "0.9.0");
  assertExists(result.warning);
  assertStringIncludes(result.warning!, "0.9.0");
  assertStringIncludes(result.warning!, "minimum");
});

Deno.test("[delegate_version] version command failure returns unsupported with warning", async () => {
  const result = await probeDelegateVersion(
    SESSION_BIN_OPENCODE,
    MINIMUM_VERSION_OPENCODE,
    mockProbeDeps("", 1),
  );
  assertEquals(result.supported, false);
  assertExists(result.warning);
});

Deno.test("[delegate_version] unparseable version string returns unsupported with warning", async () => {
  const result = await probeDelegateVersion(
    SESSION_BIN_CLAUDE_CODE,
    MINIMUM_VERSION_CLAUDE_CODE,
    mockProbeDeps("unknown version string\n"),
  );
  assertEquals(result.supported, false);
  assertExists(result.warning);
});

Deno.test("[delegate_version] version exactly at minimum is supported", async () => {
  const result = await probeDelegateVersion(
    SESSION_BIN_OPENCODE,
    "1.0.0",
    mockProbeDeps("1.0.0\n"),
  );
  assertEquals(result.supported, true);
  assertEquals(result.warning, undefined);
});

Deno.test("[delegate_version] default spawn does not throw", async () => {
  const deps: IDelegateVersionProbeDeps = {};
  // Should always resolve (never throw), regardless of whether the binary exists
  let result: IDelegateVersionResult;
  try {
    result = await probeDelegateVersion(SESSION_BIN_OPENCODE, MINIMUM_VERSION_OPENCODE, deps);
  } catch (err) {
    throw new Error(`default spawn threw unexpectedly: ${err}`);
  }
  assertExists(result);
  assertEquals(typeof result.supported, "boolean");
  assertEquals(typeof result.version, "string");
});
