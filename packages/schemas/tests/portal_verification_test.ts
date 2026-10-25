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
import {
  checkName,
  DENO_LINT_CHECK_KIND,
  denoTaskOf,
  ExecutionVerificationLintFindingsEventPayloadSchema,
  type IDenoTaskCheck,
  isDenoTaskCheck,
  type IVerificationCheck,
  type IVerificationCheckFailure,
  LINT_ERROR_CLASSES,
  LintCheckSnapshotSchema,
  LintFindingSnapshotSchema,
  PortalVerificationSchema,
  VerificationCheckSchema,
} from "@exaix/schemas/portal_verification.ts";

const BASE_CHECKS = [{ kind: "deno_task" as const, task: "test" as const }];

/** Narrows a check to a Deno task check, failing the test otherwise. */
function asDenoTask(check: IVerificationCheck | undefined): IDenoTaskCheck {
  if (check === undefined || !isDenoTaskCheck(check)) throw new Error("expected a deno_task check");
  return check;
}

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
  assertEquals(asDenoTask(parsed.verification?.checks[0]).task, "test");
});

Deno.test("[verification-schema] defaults fill max_repair_attempts, check_timeout_ms and output_max_chars", () => {
  const parsed = PortalVerificationSchema.parse({ checks: BASE_CHECKS });

  assertEquals(parsed.max_repair_attempts, DEFAULT_VERIFICATION_MAX_REPAIR_ATTEMPTS);
  assertEquals(parsed.check_timeout_ms, DEFAULT_VERIFICATION_CHECK_TIMEOUT_MS);
  assertEquals(parsed.output_max_chars, DEFAULT_VERIFICATION_OUTPUT_MAX_CHARS);
  assertEquals(asDenoTask(parsed.checks[0]).path, ".");
  assertEquals(asDenoTask(parsed.checks[0]).args, []);
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

/** A complete lint findings snapshot for one configured unslop terminal run. */
function validSnapshot(): Record<string, unknown> {
  return {
    request_id: "request-1",
    run_id: "8f2a3d1c-2b4e-4f6a-9c1d-0e2f3a4b5c6d",
    attempt: 1,
    commit_sha: "a".repeat(40),
    verification_status: "failed",
    total: 2,
    checks: [{ check_index: 0, outcome: "failed", total: 2, error_class: null }],
    findings: [{ check_index: 0, file: "src/seed.ts", line: 3, rule: "unslop/no-chained-type-assertions" }],
    truncated: true,
  };
}

Deno.test("[verification-schema] failures carry a check name and checkName maps a Deno task", () => {
  const failure: IVerificationCheckFailure = { check: "lint", exit_code: 1, output: "boom" };
  assertEquals(failure.check, "lint");
  assertEquals(checkName({ kind: "deno_task", task: "lint", path: ".", args: [] }), "lint");
  assertEquals(checkName({ kind: "deno_task", task: "fmt", path: ".", args: [] }), "fmt");
});

Deno.test("[verification-schema] the final snapshot schema accepts the authoritative payload", () => {
  const parsed = ExecutionVerificationLintFindingsEventPayloadSchema.parse(validSnapshot());
  assertEquals(parsed.total, 2);
  assertEquals(parsed.checks.length, 1);
  assertEquals(parsed.findings[0].line, 3);
  assertEquals(parsed.findings[0].rule, "unslop/no-chained-type-assertions");
  assertEquals(parsed.truncated, true);
  assertEquals(parsed.verification_status, "failed");
});

Deno.test("[verification-schema] the final snapshot schema rejects incomplete or malformed payloads", () => {
  const schema = ExecutionVerificationLintFindingsEventPayloadSchema;
  const remove = (field: string): Record<string, unknown> => {
    const copy = validSnapshot();
    delete copy[field];
    return copy;
  };
  const malformed: Record<string, unknown>[] = [
    remove("run_id"),
    { ...validSnapshot(), attempt: -1 },
    { ...validSnapshot(), total: -2 },
    { ...validSnapshot(), truncated: "no" },
    {
      ...validSnapshot(),
      findings: [{ check_index: 0, file: "", line: 1, rule: "unslop/no-chained-type-assertions" }],
    },
    {
      ...validSnapshot(),
      findings: [{ check_index: 0, file: "src/a.ts", line: 0, rule: "unslop/no-chained-type-assertions" }],
    },
    { ...validSnapshot(), checks: [{ check_index: 0, outcome: "skipped", total: 0, error_class: null }] },
    { ...validSnapshot(), checks: [{ check_index: 0, outcome: "error", total: null, error_class: "LintUnknown" }] },
  ];
  for (const payload of malformed) {
    assertEquals(schema.safeParse(payload).success, false);
  }
});

Deno.test("[verification-schema] a deno_lint check parses with the documented defaults", () => {
  const parsed = VerificationCheckSchema.parse({ kind: DENO_LINT_CHECK_KIND });
  assertEquals(checkName(parsed), DENO_LINT_CHECK_KIND);
  assertEquals(denoTaskOf(checkName(parsed)), null);
  if (parsed.kind !== DENO_LINT_CHECK_KIND) throw new Error("expected a deno_lint check");
  assertEquals(parsed.policy, "unslop");
  assertEquals(parsed.include, ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"]);
  assertEquals(parsed.exclude, ["node_modules/**", "vendor/**"]);
});

Deno.test("[verification-schema] a deno_lint check rejects unsafe input and unknown fields", () => {
  assertEquals(
    VerificationCheckSchema.safeParse({
      kind: DENO_LINT_CHECK_KIND,
      policy: "lint-2",
      include: ["src/**/*.ts"],
      exclude: ["dist/**"],
    }).success,
    true,
  );
  const invalid = [
    { policy: "Unslop" },
    { policy: "../escape" },
    { policy: "" },
    { include: [] },
    { include: ["../escape/*.ts"] },
    { include: ["/absolute/*.ts"] },
    { include: ["bad\u0000.ts"] },
    { exclude: ["../escape/*"] },
    { exclude: ["/absolute/*"] },
    { unknown: true },
  ];
  for (const partial of invalid) {
    assertEquals(
      VerificationCheckSchema.safeParse({ kind: DENO_LINT_CHECK_KIND, ...partial }).success,
      false,
      JSON.stringify(partial),
    );
  }
});

Deno.test("[verification-schema] the snapshot error class accepts every closed lint class", () => {
  for (const errorClass of LINT_ERROR_CLASSES) {
    const parsed = LintCheckSnapshotSchema.safeParse({
      check_index: 0,
      outcome: "error",
      total: null,
      error_class: errorClass,
    });
    assertEquals(parsed.success, true, errorClass);
  }
  assertEquals(
    LintCheckSnapshotSchema.safeParse({
      check_index: 0,
      outcome: "error",
      total: null,
      error_class: "LintUnknownClass",
    }).success,
    false,
  );
});

Deno.test("[verification-schema] the finding rule pattern accepts plugin and built-in ids", () => {
  for (const rule of ["unslop/no-chained-type-assertions", "ban-unused-ignore", "no-explicit-any"]) {
    assertEquals(
      LintFindingSnapshotSchema.safeParse({ check_index: 0, file: "a.ts", line: 1, rule }).success,
      true,
      rule,
    );
  }
  for (const rule of ["Unslop/Bad", "a/b/c", "has space", "-bad"]) {
    assertEquals(
      LintFindingSnapshotSchema.safeParse({ check_index: 0, file: "a.ts", line: 1, rule }).success,
      false,
      rule,
    );
  }
});

Deno.test("[verification-schema] schema-names-generic: the snapshot module keeps no Unslop identifier", async () => {
  const source = await Deno.readTextFile(new URL("../src/portal_verification.ts", import.meta.url));
  assertEquals(source.includes("Unslop"), false);
});
