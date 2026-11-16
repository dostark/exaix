/**
 * @module TestingPackagePaidLlmTest
 * @path packages/testing/tests/paid_llm_test.ts
 * @related-files ["packages/testing/src/helpers/paid_llm.ts"]
 * @architectural-layer Testing
 * @description Verifies the one switch of the live LLM tests: a live test runs only when EXA_TEST_ENABLE_PAID_LLM is 1 and every key that it needs is set.
 */
import { assertEquals } from "@std/assert";
import { ENV_TEST_ENABLE_PAID_LLM, paidLlmEnabledFor, paidLlmOptedIn, withEnv } from "@exaix/testing";

const KEY_A = "EXA_PAID_LLM_TEST_KEY_A";
const KEY_B = "EXA_PAID_LLM_TEST_KEY_B";

Deno.test("paidLlmOptedIn is true only for the value 1", async () => {
  await withEnv({ [ENV_TEST_ENABLE_PAID_LLM]: null }, () => assertEquals(paidLlmOptedIn(), false));
  await withEnv({ [ENV_TEST_ENABLE_PAID_LLM]: "" }, () => assertEquals(paidLlmOptedIn(), false));
  await withEnv({ [ENV_TEST_ENABLE_PAID_LLM]: "0" }, () => assertEquals(paidLlmOptedIn(), false));
  await withEnv({ [ENV_TEST_ENABLE_PAID_LLM]: "true" }, () => assertEquals(paidLlmOptedIn(), false));
  await withEnv({ [ENV_TEST_ENABLE_PAID_LLM]: "1" }, () => assertEquals(paidLlmOptedIn(), true));
});

Deno.test("a key alone never enables a live run", async () => {
  await withEnv({ [ENV_TEST_ENABLE_PAID_LLM]: null, [KEY_A]: "key" }, () => {
    assertEquals(paidLlmEnabledFor([KEY_A]), false);
  });
});

Deno.test("the opt-in alone enables a run without a key, and needs every named key otherwise", async () => {
  await withEnv({ [ENV_TEST_ENABLE_PAID_LLM]: "1", [KEY_A]: null, [KEY_B]: null }, () => {
    assertEquals(paidLlmEnabledFor([]), true, "a service that needs no key");
    assertEquals(paidLlmEnabledFor([KEY_A]), false, "the key is missing");
  });
  await withEnv({ [ENV_TEST_ENABLE_PAID_LLM]: "1", [KEY_A]: "key", [KEY_B]: null }, () => {
    assertEquals(paidLlmEnabledFor([KEY_A]), true);
    assertEquals(paidLlmEnabledFor([KEY_A, KEY_B]), false, "one of two keys is missing");
  });
  await withEnv({ [ENV_TEST_ENABLE_PAID_LLM]: "1", [KEY_A]: "" }, () => {
    assertEquals(paidLlmEnabledFor([KEY_A]), false, "an empty key is no key");
  });
});
