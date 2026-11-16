/**
 * @module PaidLlmGatingGuardTest
 * @path tests/integration/paid_llm_gating_guard_test.ts
 * @description Fails when a test reads the paid LLM opt-in variable or a provider key by its own code. A live LLM test enables itself through paidLlmEnabled, paidLlmEnabledFor or paidLlmOptedIn, so one rule governs every live run.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, @exaix/testing]
 * @related-files [packages/testing/src/helpers/paid_llm.ts, tests/helpers/llm_bindings.ts]
 */

import { assertEquals } from "@std/assert";
import { join, relative } from "@std/path";
import { REPO_ROOT } from "@exaix/testing";

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(["node_modules", ".git", "exaix-dev-docs", "dist"]);
const OPT_IN_READ =
  /Deno\.env\.get\(\s*(?:["']EXA_TEST_ENABLE_PAID_LLM["']|PAID_OPT_IN_ENV|ENV_TEST_ENABLE_PAID_LLM|TEST_CONST\.ENV_TEST_ENABLE_PAID_LLM)/;
const KEY_PRESENT_CALL = /\bllmKeyPresent\(/;
const PROVIDER_KEY = /["'](?:DEEPSEEK|ANTHROPIC|OPENAI|GOOGLE|OPENROUTER|OPENCODE)_API_KEY["']/;
const SHARED_GATE = /\b(?:paidLlm(?:Enabled|EnabledFor|OptedIn)|liveMatrixEnabled)\b/;
/** A test or a helper of a test: a file under a tests directory. */
const TEST_TREE = /\/tests\//;
const GATES_ITSELF = /\bignore\s*:/;
const LIVE_TEST_FILE = /live.*_test\.ts$/;
/** The helpers that own the rule, and this guard. */
const EXEMPT_FILES: ReadonlySet<string> = new Set([
  "packages/testing/src/helpers/paid_llm.ts",
  "tests/helpers/llm_bindings.ts",
  "tests/integration/paid_llm_gating_guard_test.ts",
]);

async function* testFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory) yield* testFiles(path);
    else if (entry.name.endsWith(".ts") && TEST_TREE.test(path)) yield path;
  }
}

Deno.test("no test reads the paid opt-in variable or calls llmKeyPresent outside the shared gate", async () => {
  const offenders: string[] = [];
  for await (const path of testFiles(REPO_ROOT)) {
    const name = relative(REPO_ROOT, path);
    if (EXEMPT_FILES.has(name)) continue;
    const text = await Deno.readTextFile(path);
    if (OPT_IN_READ.test(text)) offenders.push(`${name}: reads the opt-in variable`);
    if (KEY_PRESENT_CALL.test(text)) offenders.push(`${name}: calls llmKeyPresent`);
  }
  assertEquals(offenders, []);
});

Deno.test("every live test that gates itself and names a provider key uses the shared gate", async () => {
  const offenders: string[] = [];
  for await (const path of testFiles(REPO_ROOT)) {
    const name = relative(REPO_ROOT, path);
    if (EXEMPT_FILES.has(name) || !LIVE_TEST_FILE.test(name)) continue;
    const text = await Deno.readTextFile(path);
    if (GATES_ITSELF.test(text) && PROVIDER_KEY.test(text) && !SHARED_GATE.test(text)) offenders.push(name);
  }
  assertEquals(offenders, []);
});
