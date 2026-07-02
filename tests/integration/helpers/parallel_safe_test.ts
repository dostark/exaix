/**
 * @module ParallelSafeTest
 * @path tests/integration/helpers/parallel_safe_test.ts
 * @description Shared parallel-safe test helper for integration tests.
 *   Skips tests when running in parallel (DENO_JOBS set) unless
 *   EXA_TEST_FORCE_CLI_PARALLEL is explicitly set.
 */

const skipInParallel = !!Deno.env.get("DENO_JOBS") && Deno.env.get("EXA_TEST_FORCE_CLI_PARALLEL") !== "1";

export function parallelSafeTest(
  nameOrDef: string | Deno.TestDefinition,
  fn?: () => Promise<void> | void,
): void {
  if (typeof nameOrDef === "string") {
    Deno.test({ name: nameOrDef, ignore: skipInParallel, fn: fn! });
    return;
  }
  Deno.test({
    ...nameOrDef,
    ignore: skipInParallel || !!nameOrDef.ignore,
  });
}
