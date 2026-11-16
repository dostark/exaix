/**
 * @module PaidLlmGate
 * @path packages/testing/src/helpers/paid_llm.ts
 * @related-files ["packages/testing/src/constants.ts", "tests/helpers/llm_bindings.ts"]
 * @architectural-layer Testing
 * @ungrounded
 * @description The one switch of the live LLM tests. A live test runs only when EXA_TEST_ENABLE_PAID_LLM is 1 and every key that it needs is set, so a key in the environment never starts a paid run.
 */

import { ENV_TEST_ENABLE_PAID_LLM, ENV_TEST_ENABLE_PAID_LLM_VALUE } from "../constants.ts";

/** True when the operator set EXA_TEST_ENABLE_PAID_LLM to 1. */
export function paidLlmOptedIn(): boolean {
  return Deno.env.get(ENV_TEST_ENABLE_PAID_LLM) === ENV_TEST_ENABLE_PAID_LLM_VALUE;
}

/** True when the operator opted in and every key variable in `keyEnvs` is set. An empty list needs the opt-in only. */
export function paidLlmEnabledFor(keyEnvs: readonly string[]): boolean {
  return paidLlmOptedIn() && keyEnvs.every((name) => (Deno.env.get(name) ?? "").length > 0);
}
