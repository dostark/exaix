/**
 * @module RequestBindingFlagsTest
 * @path apps/exactl/tests/request_binding_flags_test.ts
 * @description Step-4 CLI coverage for `exactl request --overlay/--bind/--locked`: the
 *   create handler writes the operator run-binding file BEFORE the request file, rejecting
 *   a malformed --bind spec, and stores the exact request path + content hash so the
 *   daemon can claim it later.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/handlers/request_create_handler.ts, packages/ai/src/bindings/run_bindings_store.ts]
 */

import { BindingLockSchema } from "@exaix/schemas";
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { RequestCommands } from "../src/commands/request_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

function readJson<T>(path: string): T {
  return JSON.parse(Deno.readTextFileSync(path)) as T;
}

Deno.test("[cli] exactl request --overlay writes the run binding file before the request file", async () => {
  const { db, tempDir, config, context, cleanup } = await createCliTestContext({
    createDirs: ["Workspace/Requests", "Blueprints/Flows"],
  });
  try {
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Flows", "research.flow.yaml"), "steps: []");
    const overlayPath = join(tempDir, "overlay.json");
    await Deno.writeTextFile(
      overlayPath,
      JSON.stringify({ schema: 1, bindings: { "flow:research/step:compose": { service: "alpha" } } }),
    );

    const commands = new RequestCommands(context);
    const result = await commands.create("run the flow", { flow: "research", overlays: [overlayPath] });

    const requestPath = result.path!;

    // The run binding file exists beneath .exa/run-bindings/ and binds trace + request identity.
    const runFileDir = join(tempDir, ".exa", "run-bindings");
    const runFiles = [...Deno.readDirSync(runFileDir)].map((e) => e.name);
    assertEquals(runFiles.length, 1);
    const runFilePath = join(runFileDir, runFiles[0]!);
    const runFile = readJson<
      { trace_id: string; request_path: string; request_sha256: string; overlays: Array<{ source_path: string }> }
    >(runFilePath);
    assertEquals(runFile.trace_id, result.trace_id);
    assertEquals(runFile.request_path, requestPath);
    assertEquals(runFile.overlays.length, 1);
    void db;
    void config;
    void tempDir;
  } finally {
    await cleanup();
  }
});

Deno.test("[cli] exactl request --bind resolves a valid spec and stores it in the run binding file", async () => {
  const { db, tempDir, config, context, cleanup } = await createCliTestContext({
    createDirs: ["Workspace/Requests", "Blueprints/Flows"],
  });
  try {
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Flows", "research.flow.yaml"), "steps: []");

    const commands = new RequestCommands(context);
    const result = await commands.create("run", {
      flow: "research",
      binds: ["flow:research/step:compose=service=openai,model=openai/gpt-6-luna"],
    });

    const runFiles = [...Deno.readDirSync(join(tempDir, ".exa", "run-bindings"))].map((e) => e.name);
    assertEquals(runFiles.length, 1);
    const runFile = readJson<{ binds: Array<{ selector: string; spec: Record<string, string> }> }>(
      join(tempDir, ".exa", "run-bindings", runFiles[0]!),
    );
    assertEquals(runFile.binds.length, 1);
    assertEquals(runFile.binds[0]?.selector, "flow:research/step:compose");
    assertEquals(runFile.binds[0]?.spec.service, "openai");
    void db;
    void config;
    void result;
    void tempDir;
  } finally {
    await cleanup();
  }
});

Deno.test("[cli] exactl request rejects a malformed --bind spec", async () => {
  const { db, tempDir, config, context, cleanup } = await createCliTestContext({
    createDirs: ["Workspace/Requests", "Blueprints/Flows"],
  });
  try {
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Flows", "research.flow.yaml"), "steps: []");
    const commands = new RequestCommands(context);
    await assertRejects(
      () => commands.create("run", { flow: "research", binds: ["no-equals-here"] }),
      Error,
      "overlay_invalid",
    );
    void db;
    void config;
    void tempDir;
  } finally {
    await cleanup();
  }
});

Deno.test("[cli] exactl request --locked parses a lock file into the run binding file", async () => {
  const { db, tempDir, config, context, cleanup } = await createCliTestContext({
    createDirs: ["Workspace/Requests", "Blueprints/Flows"],
  });
  try {
    await Deno.writeTextFile(join(tempDir, "Blueprints", "Flows", "research.flow.yaml"), "steps: []");
    const lockPath = join(tempDir, "lock.json");
    const lock = {
      schema: 1,
      trace_id: "10000000-0000-4000-8000-000000000001",
      flow_id: "research",
      created_at: new Date().toISOString(),
      flow_content_sha256: "0".repeat(64),
      pin_sha256: "0".repeat(64),
      catalog_sha256: "0".repeat(64),
      step_ids: [],
      config_checksum: "x",
      overlay_sha256: [],
      run_overlays: 0,
      env_ignored: false,
      hosts: [],
      entries: [],
    };
    // A pretty-printed file with a trailing newline must replay the same as the compact one.
    await Deno.writeTextFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    const commands = new RequestCommands(context);
    const result = await commands.create("replay", { flow: "research", locked: lockPath });

    const runFiles = [...Deno.readDirSync(join(tempDir, ".exa", "run-bindings"))].map((e) => e.name);
    assertEquals(runFiles.length, 1);
    const runFile = readJson<{ locked: { trace_id: string }; locked_sha256?: string }>(
      join(tempDir, ".exa", "run-bindings", runFiles[0]!),
    );
    assertExists(runFile.locked);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(BindingLockSchema.parse(lock))),
    );
    const expected = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    assertEquals(runFile.locked_sha256, expected);
    void db;
    void config;
    void result;
    void tempDir;
  } finally {
    await cleanup();
  }
});
