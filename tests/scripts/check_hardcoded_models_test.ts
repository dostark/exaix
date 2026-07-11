/**
 * @module CheckHardcodedModelsTest
 * @path tests/scripts/check_hardcoded_models_test.ts
 * @description Tests for scripts/check_hardcoded_models.ts — ensures the CI
 *   gate correctly flags hardcoded provider:model strings in non-test TS source
 *   that are not in HARDCODED_MODEL_ALLOWLIST.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [scripts/check_hardcoded_models.ts]
 */

import { assertEquals } from "@std/assert";
import { findModelViolations } from "../../scripts/check_hardcoded_models.ts";

const ALLOWLIST = new Set([
  "mock:test",
  "mock:test-model",
]);

Deno.test("[check-hardcoded-models] allowlisted model string produces no violation", () => {
  const content = `const model = "mock:test";`;
  const violations = findModelViolations(content, "packages/foo/src/bar.ts", ALLOWLIST);
  assertEquals(violations, []);
});

Deno.test("[check-hardcoded-models] non-allowlisted model string is flagged", () => {
  const content = `const model = "anthropic:claude-3-5-sonnet";`;
  const violations = findModelViolations(content, "packages/foo/src/bar.ts", ALLOWLIST);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].model, "anthropic:claude-3-5-sonnet");
  assertEquals(violations[0].line, 1);
});

Deno.test("[check-hardcoded-models] multiple non-allowlisted strings all flagged", () => {
  const content = [
    'const a = "mock:test";',
    'const b = "anthropic:claude-unknown";',
    'const c = "google:gemini-experimental";',
  ].join("\n");
  const violations = findModelViolations(content, "packages/core/src/foo.ts", ALLOWLIST);
  assertEquals(violations.length, 2);
  assertEquals(violations[0].model, "anthropic:claude-unknown");
  assertEquals(violations[1].model, "google:gemini-experimental");
});

Deno.test("[check-hardcoded-models] non-provider:model strings are ignored", () => {
  const content = `const path = "src:some/path";`;
  const violations = findModelViolations(content, "packages/foo/src/bar.ts", ALLOWLIST);
  assertEquals(violations, []);
});

Deno.test("[check-hardcoded-models] comment lines are skipped", () => {
  const content = `// "anthropic:claude-unknown" is just a comment`;
  const violations = findModelViolations(content, "packages/foo/src/bar.ts", ALLOWLIST);
  assertEquals(violations, []);
});

Deno.test("[check-hardcoded-models] test files are skipped", () => {
  const content = `const model = "anthropic:claude-unknown";`;
  const violations = findModelViolations(content, "packages/foo/tests/bar_test.ts", ALLOWLIST);
  assertEquals(violations, []);
});

// --- .md / Blueprint file tests ---

Deno.test("[check-hardcoded-models] .md blueprint with hardcoded model is flagged", () => {
  const lines = [
    "---",
    'identity_id: "test-agent"',
    'model: "google:gemini-2.0-flash-exp"',
    "---",
    "description",
  ];
  const content = lines.join("\n");
  const violations = findModelViolations(content, "Blueprints/Identities/test-agent.md", ALLOWLIST);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].model, "google:gemini-2.0-flash-exp");
});

Deno.test("[check-hardcoded-models] .md blueprint with empty model is clean", () => {
  const lines = [
    "---",
    'identity_id: "test-agent"',
    "model:",
    "model_size: M",
    "---",
    "description",
  ];
  const content = lines.join("\n");
  const violations = findModelViolations(content, "Blueprints/Identities/test-agent.md", ALLOWLIST);
  assertEquals(violations, []);
});

Deno.test("[check-hardcoded-models] .md blueprint with model_size only is clean", () => {
  const lines = [
    "---",
    'identity_id: "test-agent"',
    "model:",
    "model_size: L",
    "thinking: true",
    "---",
    "description",
  ];
  const content = lines.join("\n");
  const violations = findModelViolations(content, "Blueprints/Identities/test-agent.md", ALLOWLIST);
  assertEquals(violations, []);
});
