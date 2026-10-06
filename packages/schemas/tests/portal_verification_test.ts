/**
 * @module PortalVerificationSchemaTest
 * @path packages/schemas/tests/portal_verification_test.ts
 * @related-files ["packages/schemas/src/portal_verification.ts", "packages/schemas/src/portal_permissions.ts"]
 * @architectural-layer Schemas
 * @description Verifies the portal post-execution verification schema: defaults, the
 *   repair-attempt hard cap, path confinement and forbidden-argument rejection.
 */

import { assert, assertEquals } from "@std/assert";
import {
  DEFAULT_VERIFICATION_CHECK_TIMEOUT_MS,
  DEFAULT_VERIFICATION_MAX_REPAIR_ATTEMPTS,
  DEFAULT_VERIFICATION_OUTPUT_MAX_CHARS,
  VERIFICATION_FORBIDDEN_ARGS,
  VERIFICATION_MAX_REPAIR_ATTEMPTS_LIMIT,
} from "@exaix/core";
import { PortalPermissionsSchema } from "@exaix/schemas/portal_permissions.ts";
import { PortalVerificationSchema, VerificationCheckSchema } from "@exaix/schemas/portal_verification.ts";

const BASE_CHECKS = [{ kind: "deno_task" as const, task: "test" as const }];

Deno.test("[verification-schema] a portal without verification parses unchanged", () => {
  const parsed = PortalPermissionsSchema.parse({
    alias: "workspace",
    target_path: "/tmp/workspace",
  });

  assertEquals(parsed.verification, undefined);
});

Deno.test("[verification-schema] a portal carries a parsed verification block", () => {
  const parsed = PortalPermissionsSchema.parse({
    alias: "workspace",
    target_path: "/tmp/workspace",
    verification: { checks: BASE_CHECKS },
  });

  assertEquals(parsed.verification?.checks.length, 1);
  assertEquals(parsed.verification?.checks[0].task, "test");
});

Deno.test("[verification-schema] defaults fill max_repair_attempts, check_timeout_ms and output_max_chars", () => {
  const parsed = PortalVerificationSchema.parse({ checks: BASE_CHECKS });

  assertEquals(parsed.max_repair_attempts, DEFAULT_VERIFICATION_MAX_REPAIR_ATTEMPTS);
  assertEquals(parsed.check_timeout_ms, DEFAULT_VERIFICATION_CHECK_TIMEOUT_MS);
  assertEquals(parsed.output_max_chars, DEFAULT_VERIFICATION_OUTPUT_MAX_CHARS);
  assertEquals(parsed.checks[0].path, ".");
  assertEquals(parsed.checks[0].args, []);
});

Deno.test("[verification-schema] max_repair_attempts above the hard cap and unknown task names are rejected", () => {
  const atLimit = PortalVerificationSchema.safeParse({
    checks: BASE_CHECKS,
    max_repair_attempts: VERIFICATION_MAX_REPAIR_ATTEMPTS_LIMIT,
  });
  assert(atLimit.success);

  const overLimit = PortalVerificationSchema.safeParse({
    checks: BASE_CHECKS,
    max_repair_attempts: VERIFICATION_MAX_REPAIR_ATTEMPTS_LIMIT + 1,
  });
  assert(!overLimit.success);

  const unknownTask = PortalVerificationSchema.safeParse({
    checks: [{ kind: "deno_task", task: "deploy" }],
  });
  assert(!unknownTask.success);
});

Deno.test("[verification-schema] an absolute path and a ../ check path are rejected", () => {
  const absolute = VerificationCheckSchema.safeParse({
    kind: "deno_task",
    task: "test",
    path: "/etc/passwd",
  });
  assert(!absolute.success);

  const traversal = VerificationCheckSchema.safeParse({
    kind: "deno_task",
    task: "test",
    path: "../outside",
  });
  assert(!traversal.success);

  const confined = VerificationCheckSchema.safeParse({
    kind: "deno_task",
    task: "test",
    path: "src",
  });
  assert(confined.success);
});

Deno.test("[verification-schema] whole-host and bare permission args are rejected; scoped allow flags are accepted", () => {
  const forbidden = [...VERIFICATION_FORBIDDEN_ARGS, "--allow-env", "--allow-run", "--allow-net"];
  for (const arg of forbidden) {
    const parsed = VerificationCheckSchema.safeParse({
      kind: "deno_task",
      task: "test",
      args: [arg],
    });
    assert(!parsed.success, `expected ${arg} to be rejected`);
  }

  const scopedRead = VerificationCheckSchema.safeParse({
    kind: "deno_task",
    task: "test",
    args: ["--allow-read=."],
  });
  assert(scopedRead.success);

  const scopedEnv = VerificationCheckSchema.safeParse({
    kind: "deno_task",
    task: "test",
    args: ["--allow-env=FOO"],
  });
  assert(scopedEnv.success);
});

function argsAccepted(args: string[]): boolean {
  return VerificationCheckSchema.safeParse({ kind: "deno_task", task: "test", args }).success;
}

Deno.test("[verification-schema] a short-flag cluster containing a permission flag (-qA, -ERN) is rejected", () => {
  for (const arg of ["-qA", "-ERN", "-Aq", "-R=."]) {
    assert(!argsAccepted([arg]), `expected ${arg} to be rejected`);
  }
  assert(argsAccepted(["-q"]), "a cluster with no permission flag stays accepted");
});

Deno.test("[verification-schema] -E, -N, -R, -W and -S are rejected", () => {
  for (const arg of ["-E", "-N", "-R", "-W", "-S", "-I"]) {
    assert(!argsAccepted([arg]), `expected ${arg} to be rejected`);
  }
});

Deno.test("[verification-schema] -P and --permission-set are rejected", () => {
  for (const arg of ["-P", "-P=ci", "--permission-set", "--permission-set=ci"]) {
    assert(!argsAccepted([arg]), `expected ${arg} to be rejected`);
  }
});

Deno.test("[verification-schema] every bare --allow-<name> flag, and an empty --allow-<name>= list, is rejected", () => {
  const bare = [
    "--allow-read",
    "--allow-write",
    "--allow-ffi",
    "--allow-sys",
    "--allow-import",
    "--allow-env",
    "--allow-run",
    "--allow-net",
  ];
  for (const arg of [...bare, "--allow-env=", "--allow-net=", "--allow-all=true"]) {
    assert(!argsAccepted([arg]), `expected ${arg} to be rejected`);
  }
});

Deno.test("[verification-schema] scoped --allow-<name>=<values> and non-permission flags are accepted", () => {
  for (
    const arg of ["--allow-read=.", "--allow-env=FOO", "--allow-run=bash", "--no-check", "--parallel", "--filter=x"]
  ) {
    assert(argsAccepted([arg]), `expected ${arg} to be accepted`);
  }
});
