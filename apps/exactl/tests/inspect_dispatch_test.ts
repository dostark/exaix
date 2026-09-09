/**
 * @module InspectDispatchTest
 * @path apps/exactl/tests/inspect_dispatch_test.ts
 * @description Phase 176 Step 3 — `exactl request inspect` reached through the real
 * `handleRequestInspect` dispatch wrapper (the exact function `exactl.ts` wires into the
 * `request inspect` action) over a genuine, isolated `ContextRecordStore` capture
 * (simulating what a completed Step 1 production launch would have written), proving
 * `--raw` re-exports the exact bytes captured at launch time — never a reconstruction —
 * without ever invoking the model provider. Also confirms the subcommand is registered
 * on the real command tree, and (gated) that a genuinely spawned `exactl` child process
 * returns the same exact bytes.
 * @architectural-layer Tests
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/command_builders/request_actions.ts, apps/exactl/src/commands/inspect_commands.ts, packages/session/src/context_record_store.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { ConfigService } from "@exaix/core/config";
import { ExaPathDefaults } from "@exaix/core";
import { PathResolver } from "@exaix/portal";
import { ContextRecordStore } from "@exaix/session";
import { CONTEXT_RECORD_SCHEMA_VERSION, type ContextRecord } from "@exaix/schemas/dogfood_context.ts";
import { handleRequestInspect } from "../src/command_builders/request_actions.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { captureAllOutputs } from "./helpers/console_utils.ts";
import { withTestMod } from "./helpers/test_utils.ts";

const TRACE_ID = "66666666-6666-4666-8666-666666666666";
const RECORD_ID = "77777777-7777-4777-8777-777777777777";
const PARENT_TRACE_ID = "88888888-8888-4888-8888-888888888888";
const PRODUCTION_PROMPT_BYTES = "the exact bytes Exaix sent to the child at launch\nline two";

function makeProductionRecord(overrides: Partial<ContextRecord> = {}): ContextRecord {
  return {
    schemaVersion: CONTEXT_RECORD_SCHEMA_VERSION,
    recordId: RECORD_ID,
    executionTraceId: TRACE_ID,
    parentTraceId: PARENT_TRACE_ID,
    stepId: "step-1",
    sequence: 1,
    turn: 0,
    attempt: 1,
    surface: "session_delegate_cycle",
    model: "anthropic:claude-sonnet-5",
    timestamp: "2026-09-10T00:00:00.000Z",
    originalInputSha256: "a".repeat(64),
    promptText: PRODUCTION_PROMPT_BYTES,
    promptSha256: "b".repeat(64),
    originalTokenCount: 120,
    finalTokenCount: 96,
    tokenSource: "counted",
    effectiveInputLimit: 16384,
    effectiveReserveLimit: 4096,
    sections: [],
    tools: [],
    visibility: "exaix_submission_only",
    nativePrompt: "unknown",
    nativeTools: "unknown",
    nativeHistory: "unknown",
    ...overrides,
  };
}

Deno.test("[dispatch] handleRequestInspect reads a real, isolated Step 1 capture and reports it", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    const store = new ContextRecordStore(new PathResolver(context.config.getAll()));
    await store.save(makeProductionRecord());

    const outs = await captureAllOutputs(async () => {
      await handleRequestInspect(context, TRACE_ID, { json: true });
    });

    const jsonLine = outs.logs.find((l) => l.trimStart().startsWith("{"));
    assert(jsonLine, `expected a JSON log line, got: ${JSON.stringify(outs.logs)}`);
    const parsed = JSON.parse(jsonLine);
    assertEquals(parsed.recordId, RECORD_ID);
    assertEquals(parsed.promptText, PRODUCTION_PROMPT_BYTES);
  } finally {
    await cleanup();
  }
});

Deno.test("[dispatch] --raw exports the exact captured bytes through the real dispatch handler and never calls the model provider", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    const store = new ContextRecordStore(new PathResolver(context.config.getAll()));
    await store.save(makeProductionRecord());

    let providerCalled = false;
    context.provider.generate = () => {
      providerCalled = true;
      throw new Error("request inspect must never invoke the model provider");
    };

    const written: Uint8Array[] = [];
    const origWrite = Deno.stdout.write.bind(Deno.stdout);
    Deno.stdout.write = (chunk: Uint8Array) => {
      written.push(chunk);
      return Promise.resolve(chunk.byteLength);
    };
    try {
      await handleRequestInspect(context, TRACE_ID, { record: RECORD_ID, raw: true });
    } finally {
      Deno.stdout.write = origWrite;
    }

    const totalLength = written.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of written) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    assertEquals(new TextDecoder().decode(merged), PRODUCTION_PROMPT_BYTES);
    assertEquals(providerCalled, false, "no retrieval/provider execution during inspection");
  } finally {
    await cleanup();
  }
});

Deno.test("[dispatch] request inspect is registered under the real `request` command group", async () => {
  await withTestMod((mod) => {
    const requestCmd = mod.__test_command.getCommand("request");
    const inspectCmd = requestCmd?.getCommand("inspect");
    assertStringIncludes(inspectCmd?.getDescription() ?? "", "captured dogfood-context");
    assertStringIncludes(inspectCmd?.getOption("record")?.flags.join(",") ?? "", "--record");
    assertStringIncludes(inspectCmd?.getOption("raw")?.flags.join(",") ?? "", "--raw");
  });
});

function buildMinimalConfig(root: string): string {
  return `
[system]
root = ${JSON.stringify(root)}
version = "1.0.0"
log_level = "info"

[paths]
memory = ${JSON.stringify(ExaPathDefaults.memory)}
blueprints = ${JSON.stringify(ExaPathDefaults.blueprints)}
runtime = ${JSON.stringify(ExaPathDefaults.runtime)}
workspace = ${JSON.stringify(ExaPathDefaults.workspace)}
portals = ${JSON.stringify(ExaPathDefaults.portals)}
active = ${JSON.stringify(ExaPathDefaults.active)}
archive = ${JSON.stringify(ExaPathDefaults.archive)}
plans = ${JSON.stringify(ExaPathDefaults.plans)}
requests = ${JSON.stringify(ExaPathDefaults.requests)}
rejected = ${JSON.stringify(ExaPathDefaults.rejected)}
agents = ${JSON.stringify(ExaPathDefaults.agents)}
flows = ${JSON.stringify(ExaPathDefaults.flows)}
memoryProjects = ${JSON.stringify(ExaPathDefaults.memoryProjects)}
memoryExecution = ${JSON.stringify(ExaPathDefaults.memoryExecution)}
memoryIndex = ${JSON.stringify(ExaPathDefaults.memoryIndex)}
memorySkills = ${JSON.stringify(ExaPathDefaults.memorySkills)}
memoryPending = ${JSON.stringify(ExaPathDefaults.memoryPending)}
memoryTasks = ${JSON.stringify(ExaPathDefaults.memoryTasks)}
memoryGlobal = ${JSON.stringify(ExaPathDefaults.memoryGlobal)}
`.trim();
}

// Real child-process invocation of the exactl entry point, isolated in its own tempDir —
// gated behind RUN_EXACTL_TEST like the other full-binary spawn test in exactl_all_test.ts,
// since the in-process dispatch tests above already cover the same handler at unit speed.
if (Deno.env.get("RUN_EXACTL_TEST")) {
  Deno.test("[dispatch] a real `exactl` child process returns the exact post-redaction bytes via --raw", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "exactl-inspect-dispatch-" });
    try {
      await Deno.mkdir(join(tempDir, ExaPathDefaults.memory), { recursive: true });
      const configPath = join(tempDir, "config.toml");
      await Deno.writeTextFile(configPath, buildMinimalConfig(tempDir));
      const configService = new ConfigService(configPath);
      const store = new ContextRecordStore(new PathResolver(configService.getAll()));
      await store.save(makeProductionRecord());

      const env = { ...Deno.env.toObject() };
      delete env.EXA_TEST_MODE;
      delete env.EXA_TEST_CLI_MODE;
      env.EXA_CONFIG_PATH = configPath;

      const cliModulePath = toFileUrl(join(Deno.cwd(), "apps/exactl/src/exactl.ts")).href;
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          "--no-check",
          cliModulePath,
          "request",
          "inspect",
          TRACE_ID,
          "--record",
          RECORD_ID,
          "--raw",
        ],
        cwd: Deno.cwd(),
        env,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await command.output();
      assertEquals(code, 0, `exactl exited non-zero. stderr: ${new TextDecoder().decode(stderr)}`);
      assertEquals(new TextDecoder().decode(stdout), PRODUCTION_PROMPT_BYTES);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  // Regression: a real EventLogger (unlike the stub display used by every other test in
  // this file) prints emitInspected's audit banner to console.log — a real subprocess is
  // the only way to catch it polluting --json's own machine-consumable stdout contract.
  Deno.test("[dispatch] a real `exactl` child process's --json stdout is pure, parseable JSON — no audit banner interleaved", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "exactl-inspect-dispatch-json-" });
    try {
      await Deno.mkdir(join(tempDir, ExaPathDefaults.memory), { recursive: true });
      const configPath = join(tempDir, "config.toml");
      await Deno.writeTextFile(configPath, buildMinimalConfig(tempDir));
      const configService = new ConfigService(configPath);
      const store = new ContextRecordStore(new PathResolver(configService.getAll()));
      await store.save(makeProductionRecord());

      const env = { ...Deno.env.toObject() };
      delete env.EXA_TEST_MODE;
      delete env.EXA_TEST_CLI_MODE;
      env.EXA_CONFIG_PATH = configPath;

      const cliModulePath = toFileUrl(join(Deno.cwd(), "apps/exactl/src/exactl.ts")).href;
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          "--no-check",
          cliModulePath,
          "request",
          "inspect",
          TRACE_ID,
          "--record",
          RECORD_ID,
          "--json",
        ],
        cwd: Deno.cwd(),
        env,
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await command.output();
      assertEquals(code, 0, `exactl exited non-zero. stderr: ${new TextDecoder().decode(stderr)}`);
      const parsed = JSON.parse(new TextDecoder().decode(stdout));
      assertEquals(parsed.recordId, RECORD_ID);
      assertEquals(parsed.promptText, PRODUCTION_PROMPT_BYTES);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
} else {
  Deno.test({
    name: "[dispatch] a real `exactl` child process returns the exact post-redaction bytes via --raw (skipped)",
    ignore: true,
    fn: () => {},
  });
  Deno.test({
    name: "[dispatch] a real `exactl` child process's --json stdout is pure, parseable JSON (skipped)",
    ignore: true,
    fn: () => {},
  });
}
