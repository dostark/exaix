/**
 * @module GoPortCoreL0PromptBudgetReferenceTest
 * @path tests/scripts/go_port_core_l0_prompt_budget_reference_test.ts
 * @description Exercises the recorder of the prompt budget cases. The Go checkout verifies the committed cases itself.
 * @architectural-layer Test
 */
import { assert, assertEquals } from "@std/assert";
import { buildPromptBudgetFixture } from "../../scripts/go_port/core_l0_prompt_budget_reference.ts";

interface IBudgetCase {
  readonly name: string;
  readonly input: { readonly window_source: string; readonly local: boolean; readonly context_window_tokens: number };
  readonly expected: { readonly ok: boolean; readonly budget?: { readonly safetyBufferTokens: number } };
}

async function recordedCases(): Promise<IBudgetCase[]> {
  const fixture: { cases: IBudgetCase[] } = JSON.parse(JSON.stringify(await buildPromptBudgetFixture()));
  return fixture.cases;
}

Deno.test("go-port-core-l0-prompt-budget: case names are unique and the same run gives the same bytes", async () => {
  const first = await buildPromptBudgetFixture();
  const second = await buildPromptBudgetFixture();
  assertEquals(JSON.stringify(first), JSON.stringify(second));
  const names = (await recordedCases()).map((entry) => entry.name);
  assertEquals(new Set(names).size, names.length);
});

Deno.test("go-port-core-l0-prompt-budget: the cases reach the enforced, relaxed and exceeded branches", async () => {
  const cases = await recordedCases();
  const exceeded = cases.filter((entry) => !entry.expected.ok);
  const relaxed = cases.filter((entry) => entry.expected.ok && entry.expected.budget?.safetyBufferTokens === 0);
  const enforced = cases.filter((entry) => entry.expected.ok && (entry.expected.budget?.safetyBufferTokens ?? 0) > 0);
  assert(exceeded.length > 0 && relaxed.length > 0 && enforced.length > 0);
});

Deno.test("go-port-core-l0-prompt-budget: fallback windows are recorded as the resolved window of the case", async () => {
  const cases = await recordedCases();
  const local = cases.find((entry) => entry.input.window_source === "local_fallback");
  const cloud = cases.find((entry) => entry.input.window_source === "cloud_fallback");
  assertEquals(local?.input.context_window_tokens, 32_768);
  assertEquals(cloud?.input.context_window_tokens, 128_000);
  assert(cases.some((entry) => entry.input.window_source === "registry"));
});

Deno.test("go-port-core-l0-prompt-budget: the boundary pair differs only by one hinted token", async () => {
  const cases = await recordedCases();
  assertEquals(cases.find((entry) => entry.name === "hints-equal-the-window")?.expected.ok, true);
  assertEquals(cases.find((entry) => entry.name === "hints-one-over-the-window")?.expected.ok, false);
});
