/**
 * @module DenoTaskSecurityTest
 * @path packages/tool-runtime/tests/deno_task_security_test.ts
 * @related-files ["packages/tool-runtime/src/tool_registry.ts", "packages/tool-runtime/src/deno_task_runner.ts"]
 * @architectural-layer Tests
 * @description Security regression for Finding 14. run_deno_task must reject caller-selected
 *   Deno permissions, config or preload overrides and extra operands before any spawn.
 *   It must also start the child without the ambient daemon environment.
 */

import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { ALLOWED_PARENT_ENV_KEYS, type ISubprocessOptions, SafeSubprocess, ToolName } from "@exaix/core";
import { cleanupTempDir, createToolRegistryForTests } from "./helpers.ts";

const FORBIDDEN_DENO_TASK_ARGS: ReadonlyArray<readonly [string, string[]]> = [
  ["test", ["-A"]],
  ["test", ["--allow-all"]],
  ["test", ["--allow-write"]],
  ["test", ["--allow-read=/"]],
  ["test", ["--allow-all", "--no-config"]],
  ["test", ["--no-config"]],
  ["test", ["--config=evil.json"]],
  ["test", ["-c", "evil.json"]],
  ["test", ["--preload=evil.ts"]],
  ["test", ["--import-map=evil.json"]],
  ["test", ["--permission-set=all"]],
  ["test", ["-P"]],
  ["test", ["--filter"]],
  ["test", ["/tmp/outside_test.ts"]],
  ["lint", ["--config", "evil.json"]],
  ["fmt", ["--check", "../outside.ts"]],
  ["check", ["--allow-import"]],
];

Deno.test("[security] run_deno_task rejects forbidden arguments before any subprocess starts", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "deno-task-sec-reject-" });
  const registry = createToolRegistryForTests(tempDir);
  let spawned = 0;
  const s = stub(SafeSubprocess, "run", () => {
    spawned++;
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  });
  try {
    for (const [task, args] of FORBIDDEN_DENO_TASK_ARGS) {
      const result = await registry.execute(ToolName.DENO_TASK, { task, path: tempDir, args });
      assert(!result.success, `'${task} ${args.join(" ")}' must be rejected`);
      assert(
        result.error?.includes("not allowed"),
        `'${task} ${args.join(" ")}' must be rejected by validation. Got: ${result.error}`,
      );
    }
    assertEquals(spawned, 0, "no forbidden invocation may reach the subprocess");
  } finally {
    s.restore();
    await cleanupTempDir(tempDir);
  }
});

Deno.test("[security] run_deno_task accepts the allowlisted options for each task", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "deno-task-sec-accept-" });
  const registry = createToolRegistryForTests(tempDir);
  const captured: string[][] = [];
  const s = stub(SafeSubprocess, "run", (_command: string, args: string[]) => {
    captured.push(args);
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  });
  try {
    const allowed: ReadonlyArray<readonly [string, string[]]> = [
      ["test", ["--filter=parses input", "--fail-fast"]],
      ["lint", ["--json"]],
      ["fmt", ["--check"]],
      ["check", []],
    ];
    for (const [task, args] of allowed) {
      const result = await registry.execute(ToolName.DENO_TASK, { task, path: tempDir, args });
      assert(result.success, `'${task} ${args.join(" ")}' must be accepted. Got: ${result.error}`);
    }
    assertEquals(captured.length, allowed.length);
    assertEquals(captured[0].slice(0, 3), ["test", "--filter=parses input", "--fail-fast"]);
  } finally {
    s.restore();
    await cleanupTempDir(tempDir);
  }
});

Deno.test("[security] run_deno_task starts the child with the allowlist environment only", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "deno-task-sec-env-" });
  const registry = createToolRegistryForTests(tempDir);
  const captured: { options?: ISubprocessOptions } = {};
  const s = stub(SafeSubprocess, "run", (_command: string, _args: string[], options?: ISubprocessOptions) => {
    captured.options = options;
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  });
  try {
    const result = await registry.execute(ToolName.DENO_TASK, { task: "lint", path: tempDir });
    assert(result.success, result.error);
    assertEquals(captured.options?.clearEnv, true);
    const keys = Object.keys(captured.options?.env ?? {});
    assert(
      keys.every((key) => ALLOWED_PARENT_ENV_KEYS.includes(key)),
      `child env must hold only allowlisted keys. Got: ${keys.join(", ")}`,
    );
  } finally {
    s.restore();
    await cleanupTempDir(tempDir);
  }
});

Deno.test("[security] run_deno_task cannot grant a test file write access outside the root", async () => {
  const parentDir = await Deno.realPath(await Deno.makeTempDir({ prefix: "deno-task-sec-escape-" }));
  const rootDir = join(parentDir, "root");
  const outsideDir = join(parentDir, "outside");
  await Deno.mkdir(rootDir);
  await Deno.mkdir(outsideDir);
  const marker = join(outsideDir, "marker.txt");
  const payload = join(rootDir, "payload_test.ts");
  await Deno.writeTextFile(
    payload,
    `Deno.test("payload", () => { Deno.writeTextFileSync(${JSON.stringify(marker)}, "escaped"); });\n`,
  );
  const registry = createToolRegistryForTests(rootDir);
  try {
    const attack = await registry.execute(ToolName.DENO_TASK, {
      task: "test",
      path: payload,
      args: ["--allow-all", "--no-config"],
    });
    assert(!attack.success);
    assert(attack.error?.includes("not allowed"), `must be rejected by validation. Got: ${attack.error}`);

    const plain = await registry.execute(ToolName.DENO_TASK, { task: "test", path: payload });
    assert(!plain.success, "a test without granted permissions must fail its write");

    const markerExists = await Deno.stat(marker).then(() => true, () => false);
    assert(!markerExists, "the payload must not write outside the root");
  } finally {
    await cleanupTempDir(parentDir);
  }
});

Deno.test("[deno-task] run_deno_task still runs an in-root test that needs no permissions", async () => {
  const tempDir = await Deno.realPath(await Deno.makeTempDir({ prefix: "deno-task-sec-ok-" }));
  const registry = createToolRegistryForTests(tempDir);
  try {
    const testFile = join(tempDir, "ok_test.ts");
    await Deno.writeTextFile(testFile, `Deno.test("ok", () => {});\n`);
    const result = await registry.execute(ToolName.DENO_TASK, { task: "test", path: testFile, args: ["--quiet"] });
    assert(result.success, result.error);
  } finally {
    await cleanupTempDir(tempDir);
  }
});
