/**
 * @module EnvHelperSelfTest
 * @path tests/helpers/env_test.ts
 * @description Verifies the project's environment manipulation helpers, ensuring
 * stable nesting and restoration across synchronous and asynchronous tests.
 */

import { withEnv } from "./env.ts";
import { assertEquals } from "@std/assert";

Deno.test("withEnv sets and restores env vars (sync)", async () => {
  const key = "EXA_TEST_WITHENV_SYNC";
  Deno.env.delete(key);
  await withEnv({ [key]: "1" }, () => {
    assertEquals(Deno.env.get(key), "1");
  });
  assertEquals(Deno.env.get(key), undefined);
});

Deno.test("withEnv sets and restores env vars (async)", async () => {
  const key = "EXA_TEST_WITHENV_ASYNC";
  Deno.env.delete(key);
  await withEnv({ [key]: "2" }, async () => {
    assertEquals(Deno.env.get(key), "2");
    await Promise.resolve();
  });
  assertEquals(Deno.env.get(key), undefined);
});
