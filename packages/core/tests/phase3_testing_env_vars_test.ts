/**
 * @module TestModeEnvVarsTest
 * @path packages/core/tests/phase3_testing_env_vars_test.ts
 * @description Verifies the logic for test-mode detection helpers exposed by
 * @exaix/core/config/env_schema.ts.
 */

import { assertEquals } from "@std/assert";
import { withEnv } from "@exaix/testing";
import { isCIMode, isTestMode } from "@exaix/core/config/env_schema.ts";

Deno.test({
  name: "Phase 3: isTestMode() returns false when EXA_TEST_MODE not set",
  fn() {
    withEnv({ EXA_TEST_MODE: null, EXA_TEST_CLI_MODE: null }, () => {
      assertEquals(isTestMode(), false);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Phase 3: isTestMode() returns true when EXA_TEST_MODE=1",
  fn() {
    withEnv({ EXA_TEST_MODE: "1" }, () => {
      assertEquals(isTestMode(), true);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Phase 3: isTestMode() returns true when EXA_TEST_MODE=true",
  fn() {
    withEnv({ EXA_TEST_MODE: "true" }, () => {
      assertEquals(isTestMode(), true);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Phase 3: isTestMode() returns false when EXA_TEST_MODE=0",
  fn() {
    withEnv({ EXA_TEST_MODE: "0", EXA_TEST_CLI_MODE: null }, () => {
      assertEquals(isTestMode(), false);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Phase 3: isTestMode() returns false when EXA_TEST_MODE=false",
  fn() {
    withEnv({ EXA_TEST_MODE: "false", EXA_TEST_CLI_MODE: null }, () => {
      assertEquals(isTestMode(), false);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Phase 3: isCIMode() returns false when neither CI nor EXA_CI_MODE set",
  fn() {
    withEnv({ CI: null, EXA_CI_MODE: null }, () => {
      assertEquals(isCIMode(), false);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Phase 3: isCIMode() returns true when CI=1",
  fn() {
    withEnv({ CI: "1" }, () => {
      assertEquals(isCIMode(), true);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Phase 3: isCIMode() returns true when CI=true",
  fn() {
    withEnv({ CI: "true" }, () => {
      assertEquals(isCIMode(), true);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Phase 3: isCIMode() returns true when EXA_CI_MODE=1",
  fn() {
    withEnv({ EXA_CI_MODE: "1" }, () => {
      assertEquals(isCIMode(), true);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Phase 3: isCIMode() returns false when CI=0",
  fn() {
    withEnv({ CI: "0" }, () => {
      assertEquals(isCIMode(), false);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Phase 3: isCIMode() returns false when CI=false",
  fn() {
    withEnv({ CI: "false" }, () => {
      assertEquals(isCIMode(), false);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "Phase 3: isCIMode() prefers EXA_CI_MODE over CI",
  fn() {
    withEnv({ CI: "0", EXA_CI_MODE: "1" }, () => {
      assertEquals(isCIMode(), true);
    });

    withEnv({ CI: "1", EXA_CI_MODE: "0" }, () => {
      assertEquals(isCIMode(), false);
    });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
