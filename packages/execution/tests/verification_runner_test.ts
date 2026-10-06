/**
 * @module VerificationRunnerTest
 * @path packages/execution/tests/verification_runner_test.ts
 * @related-files ["packages/execution/src/verification_runner.ts"]
 * @architectural-layer Tests
 * @description Tests VerificationRunner: pass, fail, error (confinement, timeout), tail
 *   truncation, worktree-safe fmt and the cleared allowlist child environment.
 */

import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import { type ISubprocessOptions, SafeSubprocess } from "@exaix/core";
import type { LogMetadata } from "@exaix/core/types";
import { type IPortalVerification, PortalVerificationSchema } from "@exaix/schemas";
import { VerificationRunner } from "@exaix/execution";
import { withEnv } from "@exaix/testing";

interface ICapturedEvent {
  action: string;
  payload?: LogMetadata;
  traceId?: string;
}

function createCapturingLogger(captured: ICapturedEvent[]): IEventLogger {
  const record = (action: string, _target: string | null, payload?: LogMetadata, traceId?: string): Promise<void> => {
    captured.push({ action, payload, traceId });
    return Promise.resolve();
  };
  const logger: IEventLogger = {
    log: (event) => record(event.action ?? "", event.target ?? null, event.payload),
    info: record,
    warn: record,
    error: record,
    fatal: record,
    debug: record,
    child: () => logger,
  };
  return logger;
}

interface IVerificationOverrides {
  max_repair_attempts?: number;
  check_timeout_ms?: number;
  output_max_chars?: number;
}

function parseConfig(
  checks: Array<{ kind: "deno_task"; task: "test" | "lint" | "check" | "fmt"; path?: string; args?: string[] }>,
  overrides: IVerificationOverrides = {},
): IPortalVerification {
  return PortalVerificationSchema.parse({ checks, ...overrides });
}

async function makeRoot(prefix: string): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir({ prefix }));
}

function stubRun(
  fn: (
    command: string,
    args: string[],
    options?: ISubprocessOptions,
  ) => Promise<{ code: number; stdout: string; stderr: string }>,
) {
  return stub(SafeSubprocess, "run", fn);
}

Deno.test("[verification-runner] passing checks return passed and emit started+passed on one trace", async () => {
  const root = await makeRoot("verification-pass-");
  try {
    await Deno.writeTextFile(
      join(root, "pass_test.ts"),
      'Deno.test("ok", () => { if (1 !== 1) throw new Error("no"); });\n',
    );
    const captured: ICapturedEvent[] = [];
    const runner = new VerificationRunner(createCapturingLogger(captured), []);

    const result = await runner.run(parseConfig([{ kind: "deno_task", task: "test" }]), {
      requestId: "req-1",
      traceId: "trace-1",
      attempt: 0,
      executionRoot: root,
    });

    assertEquals(result, { passed: true, error: false, failures: [] });
    const started = captured.filter((e) => e.action === DomainEventType.ExecutionVerificationStarted);
    const passed = captured.filter((e) => e.action === DomainEventType.ExecutionVerificationPassed);
    assertEquals(started.length, 1);
    assertEquals(passed.length, 1);
    assertEquals(started[0].traceId, "trace-1");
    assertEquals(passed[0].traceId, "trace-1");
    assertEquals(started[0].payload?.checks, ["test"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[verification-runner] a failing check returns its exit code and the truncated output tail", async () => {
  const root = await makeRoot("verification-fail-");
  const s = stubRun(() => Promise.resolve({ code: 1, stdout: "A".repeat(30) + "B".repeat(30), stderr: "" }));
  try {
    const runner = new VerificationRunner(createCapturingLogger([]), []);

    const result = await runner.run(
      parseConfig([{ kind: "deno_task", task: "test" }], { output_max_chars: 40 }),
      { requestId: "req-1", traceId: "trace-1", attempt: 1, executionRoot: root },
    );

    assertEquals(result.passed, false);
    assertEquals(result.error, false);
    assertEquals(result.failures.length, 1);
    assertEquals(result.failures[0].task, "test");
    assertEquals(result.failures[0].exit_code, 1);
    assertEquals(result.failures[0].output, "A".repeat(10) + "B".repeat(30));
  } finally {
    s.restore();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[verification-runner] a symlink inside the worktree pointing outside it is an error and nothing is spawned", async () => {
  const root = await makeRoot("verification-symlink-");
  const outside = await makeRoot("verification-outside-");
  let spawned = false;
  const s = stubRun(() => {
    spawned = true;
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  });
  try {
    await Deno.writeTextFile(join(outside, "escaped_test.ts"), 'Deno.test("x", () => {});\n');
    await Deno.symlink(outside, join(root, "link"));

    const runner = new VerificationRunner(createCapturingLogger([]), []);
    const result = await runner.run(
      parseConfig([{ kind: "deno_task", task: "test", path: "link" }]),
      { requestId: "req-1", traceId: "trace-1", attempt: 0, executionRoot: root },
    );

    assertEquals(result.error, true);
    assertEquals(result.passed, false);
    assertEquals(result.failures.length, 1);
    assertEquals(result.failures[0].exit_code, null);
    assertEquals(spawned, false);
  } finally {
    s.restore();
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("[verification-runner] an unformatted file fails fmt and the worktree is unchanged afterwards", async () => {
  const root = await makeRoot("verification-fmt-");
  try {
    const content = "const x=1\n";
    await Deno.writeTextFile(join(root, "bad.ts"), content);
    const runner = new VerificationRunner(createCapturingLogger([]), []);

    const result = await runner.run(parseConfig([{ kind: "deno_task", task: "fmt" }]), {
      requestId: "req-1",
      traceId: "trace-1",
      attempt: 0,
      executionRoot: root,
    });

    assertEquals(result.passed, false);
    assertEquals(result.error, false);
    assertEquals(await Deno.readTextFile(join(root, "bad.ts")), content);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[verification-runner] a check cannot read a daemon env var", async () => {
  const root = await makeRoot("verification-env-");
  try {
    await Deno.writeTextFile(
      join(root, "env_test.ts"),
      'Deno.test("env", () => { const v = Deno.env.get("EXA_TEST_SECRET"); if (v !== "leaked") throw new Error(`SECRET=${v}`); });\n',
    );
    await withEnv({ EXA_TEST_SECRET: "leaked" }, async () => {
      const runner = new VerificationRunner(createCapturingLogger([]), []);
      const result = await runner.run(
        parseConfig([{ kind: "deno_task", task: "test", args: ["--allow-env=EXA_TEST_SECRET"] }]),
        { requestId: "req-1", traceId: "trace-1", attempt: 0, executionRoot: root },
      );

      assertEquals(result.passed, false);
      assert(result.failures[0].output.includes("SECRET=undefined"), result.failures[0].output);
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[verification-runner] a timed-out check is an error with exit_code null and stops the run", async () => {
  const root = await makeRoot("verification-timeout-");
  try {
    await Deno.writeTextFile(
      join(root, "slow_test.ts"),
      'Deno.test("slow", async () => { await new Promise((r) => setTimeout(r, 10_000)); });\n',
    );
    await Deno.writeTextFile(join(root, "bad.ts"), "const y=2\n");
    const runner = new VerificationRunner(createCapturingLogger([]), []);

    const result = await runner.run(
      parseConfig([
        { kind: "deno_task", task: "test" },
        { kind: "deno_task", task: "fmt" },
      ], { check_timeout_ms: 700 }),
      { requestId: "req-1", traceId: "trace-1", attempt: 0, executionRoot: root },
    );

    assertEquals(result.error, true);
    assertEquals(result.failures.length, 1);
    assertEquals(result.failures[0].task, "test");
    assertEquals(result.failures[0].exit_code, null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[verification-runner] the check env is exactly buildChildEnv allowlist output: no proxy, secret or injection var", async () => {
  const root = await makeRoot("verification-childenv-");
  const captured: { options?: ISubprocessOptions } = {};
  const s = stubRun((_command, _args, options) => {
    captured.options = options;
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  });
  try {
    await withEnv(
      { EXA_TEST_SECRET: "s3cr3t", HTTP_PROXY: "http://proxy", LD_PRELOAD: "/evil.so" },
      async () => {
        const runner = new VerificationRunner(createCapturingLogger([]), []);
        const result = await runner.run(parseConfig([{ kind: "deno_task", task: "test" }]), {
          requestId: "req-1",
          traceId: "trace-1",
          attempt: 0,
          executionRoot: root,
        });
        assertEquals(result.passed, true);
      },
    );

    assertEquals(captured.options?.clearEnv, true);
    const keys = Object.keys(captured.options?.env ?? {});
    assertEquals(keys.includes("EXA_TEST_SECRET"), false);
    assertEquals(keys.includes("HTTP_PROXY"), false);
    assertEquals(keys.includes("LD_PRELOAD"), false);
    assert(keys.includes("PATH"), keys.join(","));
  } finally {
    s.restore();
    await Deno.remove(root, { recursive: true });
  }
});
