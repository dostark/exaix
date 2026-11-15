/**
 * @module CommandFailureTest
 * @path apps/exactl/tests/command_failure_test.ts
 * @description Verifies that toExaCtlError turns the not-found errors of the packages into the NOT_FOUND exit code and any other error into FAILURE.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/command_builders/command_failure.ts]
 * @related-files [apps/exactl/src/command_builders/command_failure.ts, packages/core/src/config/errors.ts]
 */

import { assertEquals } from "@std/assert";
import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { ConfigKeyNotFoundError } from "@exaix/core/config";
import { RequestNotFoundError } from "@exaix/core/errors";
import { FlowNotFoundError } from "@exaix/flow";
import { PortalNotFoundError } from "@exaix/portal";
import { toExaCtlError } from "../src/command_builders/command_failure.ts";

const MISSING = "nope";

Deno.test("toExaCtlError maps PortalNotFoundError, FlowNotFoundError, RequestNotFoundError and ConfigKeyNotFoundError to NOT_FOUND", () => {
  const errors: Error[] = [
    new PortalNotFoundError(MISSING),
    new FlowNotFoundError(MISSING),
    new RequestNotFoundError(MISSING),
    new ConfigKeyNotFoundError(MISSING),
  ];
  for (const error of errors) {
    const mapped = toExaCtlError(error);
    assertEquals(mapped.code, ExaCtlExitCode.NOT_FOUND, error.name);
    assertEquals(mapped.message, error.message);
  }
});

Deno.test("toExaCtlError keeps an ExaCtlError and maps any other error to FAILURE", () => {
  const kept = new ExaCtlError(ExaCtlExitCode.INVALID, "invalid");
  assertEquals(toExaCtlError(kept), kept);
  assertEquals(toExaCtlError(new Error("boom")).code, ExaCtlExitCode.FAILURE);
});
