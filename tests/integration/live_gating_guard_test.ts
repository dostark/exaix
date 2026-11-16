/**
 * @module LiveGatingGuardTest
 * @path tests/integration/live_gating_guard_test.ts
 * @description Fails when a test enables itself for a live call by its own code. A live test reads its opt-in, key and binary through the `live-<service>` preset row of tests/configs/model_presets.toml, so one set of predicates governs every live run.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, @exaix/testing]
 * @related-files [tests/helpers/live_presets.ts, tests/helpers/llm_bindings.ts]
 */

import { assertEquals } from "@std/assert";
import { join, relative } from "@std/path";
import { REPO_ROOT } from "@exaix/testing";

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(["node_modules", ".git", "exaix-dev-docs", "dist"]);
/** A test or a helper of a test: a file under a tests directory. */
const TEST_TREE = /\/tests\//;
/** An opt-in variable of a live run. It is read through a preset predicate, never by the test. */
const OPT_IN_READ =
  /Deno\.env\.get\(\s*(?:["']EXA_(?:MATRIX_(?!OLLAMA_MODEL)|RUN_LIVE_|TEST_LIVE_|TEST_ENABLE_|CALIBRATION_SANDBOX_LIVE)|PAID_OPT_IN_ENV|ENV_TEST_ENABLE_PAID_LLM|TEST_CONST\.ENV_TEST_ENABLE_PAID_LLM)/;
const KEY_PRESENT_CALL = /\bllmKeyPresent\(/;
const PROVIDER_KEY = /["'](?:DEEPSEEK|ANTHROPIC|OPENAI|GOOGLE|OPENROUTER|OPENCODE)_API_KEY["']/;
/** The ways a live test asks its preset whether it may run. */
const PRESET_GATE = /\b(?:liveSkipReason|liveLlmEnabled|liveLlmSkipReason|liveMatrixEnabled)\b/;
const GATES_ITSELF = /\bignore\s*:/;
const LIVE_TEST_FILE = /live.*_test\.ts$/;
/** The code that owns the rule: the preset reader, the scenario runner that evaluates the same predicates, and this guard. */
const EXEMPT_PREFIXES: readonly string[] = [
  "tests/helpers/live_presets.ts",
  "tests/helpers/llm_bindings.ts",
  "tests/scenario_framework/runner/",
  "tests/integration/live_gating_guard_test.ts",
];

async function* testFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory) yield* testFiles(path);
    else if (entry.name.endsWith(".ts") && TEST_TREE.test(path)) yield path;
  }
}

function isExempt(name: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

Deno.test("no test reads a live opt-in variable or calls llmKeyPresent by its own code", async () => {
  const offenders: string[] = [];
  for await (const path of testFiles(REPO_ROOT)) {
    const name = relative(REPO_ROOT, path);
    if (isExempt(name)) continue;
    const text = await Deno.readTextFile(path);
    if (OPT_IN_READ.test(text)) offenders.push(`${name}: reads an opt-in variable`);
    if (KEY_PRESENT_CALL.test(text)) offenders.push(`${name}: calls llmKeyPresent`);
  }
  assertEquals(offenders, []);
});

Deno.test("every live test that gates itself and names a provider key asks its preset", async () => {
  const offenders: string[] = [];
  for await (const path of testFiles(REPO_ROOT)) {
    const name = relative(REPO_ROOT, path);
    if (isExempt(name) || !LIVE_TEST_FILE.test(name)) continue;
    const text = await Deno.readTextFile(path);
    if (GATES_ITSELF.test(text) && PROVIDER_KEY.test(text) && !PRESET_GATE.test(text)) offenders.push(name);
  }
  assertEquals(offenders, []);
});
