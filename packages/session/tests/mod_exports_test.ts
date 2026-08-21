/**
 * @module SessionModExportsTest
 * @path packages/session/tests/mod_exports_test.ts
 * @description Verifies the public session barrel exposes Phase 167 Codex sandbox derivation.
 * @architectural-layer Tests
 * @related-files [packages/session/mod.ts, packages/session/src/mod.ts]
 */

import { assertEquals } from "@std/assert";
import { deriveCodexSandboxFlags } from "@exaix/session";

Deno.test("[session_exports] exposes deriveCodexSandboxFlags from the package barrel", () => {
  assertEquals(typeof deriveCodexSandboxFlags, "function");
});
