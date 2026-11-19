/**
 * @module GoPortGoStubTest
 * @path tests/scripts/go_port_go_stub_test.ts
 * @description Runs the exaix-go module, role dispatch and separate-module internal boundary with the pinned Go toolchain.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [scripts/go_port/scenario_baseline.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const GO_ROOT = join(REPO_ROOT, "..", "exaix-go");
const GO = Deno.env.get("GO_BIN") ?? "go";
const GO_VERSION = "go1.27.4";

interface IRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(cwd: string, args: readonly string[]): Promise<IRun> {
  const result = await new Deno.Command(GO, {
    args: [...args],
    cwd,
    env: { ...Deno.env.toObject(), GOWORK: "off", GOTOOLCHAIN: "local" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return { code: result.code, stdout: decoder.decode(result.stdout), stderr: decoder.decode(result.stderr) };
}

Deno.test("go-edition-stub-build: the module and separate edition stub build with GOWORK=off", async () => {
  const root = await run(GO_ROOT, ["build", "./..."]);
  assertEquals(root.code, 0, root.stderr);
  const stub = await run(join(GO_ROOT, "editionstub"), ["build", "./..."]);
  assertEquals(stub.code, 0, stub.stderr);
});

Deno.test("go-role-dispatch: known roles run and an unknown role fails", async () => {
  const known = await run(GO_ROOT, ["run", "./cmd/exaix", "daemon"]);
  assertEquals(known.code, 0, known.stderr);
  const unknown = await run(GO_ROOT, ["run", "./cmd/exaix", "unknown"]);
  assertEquals(unknown.code, 1);
  assertStringIncludes(unknown.stderr, "unknown role");
  const version = await run(GO_ROOT, ["version"]);
  assertStringIncludes(version.stdout, GO_VERSION);
});

Deno.test("go-internal-boundary: a separate module cannot import internal", async () => {
  const dir = await Deno.makeTempDir({ prefix: "go_boundary_" });
  try {
    await Deno.writeTextFile(
      join(dir, "go.mod"),
      `module example.com/boundary\n\ngo 1.27.4\n\nrequire github.com/dostark/exaix-go v0.0.0\nreplace github.com/dostark/exaix-go => ${GO_ROOT}\n`,
    );
    await Deno.writeTextFile(
      join(dir, "main.go"),
      'package main\n\nimport _ "github.com/dostark/exaix-go/internal/platform"\n\nfunc main() {}\n',
    );
    const result = await run(dir, ["build", "./..."]);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "internal");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
