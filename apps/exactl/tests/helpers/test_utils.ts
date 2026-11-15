// deno-lint-ignore-file no-explicit-any
/**
 * @module CliTestUtils
 * @path apps/exactl/tests/helpers/test_utils.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Test utilities for CLI command testing.
 */

import type { ExaCtlTestContext } from "../../src/exactl.ts";
import type * as ExaCtlModule from "../../src/exactl.ts";
import * as exactlModule from "../../src/exactl.ts";
import { RequestPriority, RequestSource } from "@exaix/core";
import type { IRequest } from "@exaix/core/request";
import { RequestStatus } from "@exaix/core/status";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import { ExaCtlError } from "@exaix/cli/errors/exactl_errors.ts";
import { ensureDir } from "@std/fs";
import { readConfigFixture } from "../../../../tests/integration/helpers/config_fixture.ts";
import { captureConsoleOutput as captureConsoleOutputShared, runWithTimeout } from "./console_utils.ts";

// Static import avoids a runtime dynamic import statement inside a function,
// which is prohibited by the test style checker.
const exactlModulePromise: Promise<typeof import("../../src/exactl.ts")> = Promise.resolve(exactlModule);

function loadExaCtlModule(): Promise<typeof import("../../src/exactl.ts")> {
  return exactlModulePromise;
}

export async function withTestMod<T>(
  fn: (mod: typeof ExaCtlModule, ctx: ExaCtlTestContext) => Promise<T> | T,
): Promise<T> {
  const origEnv = Deno.env.get("EXA_TEST_CLI_MODE") ?? Deno.env.get("EXA_TEST_MODE");
  Deno.env.set("EXA_TEST_CLI_MODE", "1");
  Deno.env.set("EXA_TEST_MODE", "1");
  let ctx: ExaCtlTestContext | undefined;
  const tempDir: string = await Deno.makeTempDir({ prefix: "exa-test-" });
  await ensureDir(tempDir);
  const configPath: string = join(tempDir, "config.toml");
  const configContent = readConfigFixture("exactl-test-mod-config");
  await Deno.writeTextFile(configPath, configContent);
  // Set EXA_CONFIG_PATH before any CLI code loads
  Deno.env.set("EXA_CONFIG_PATH", configPath);
  try {
    const loadedMod = await loadExaCtlModule();
    // Use real DB in test mode if possible
    if (loadedMod.__test_initializeServices) {
      const services = await loadedMod.__test_initializeServices({ instantiateDb: true, configPath });
      ctx = {
        ...loadedMod.__test_getContext(),
        db: services.db,
      };
    } else {
      ctx = loadedMod.__test_getContext();
    }
    const originalOut = ctx.outputSink.out;
    // Renderer output goes through console.log here, so tests that capture console output still see it.
    ctx.outputSink.out = (text) => {
      console.log(text.replace(/\n$/, ""));
      return Promise.resolve();
    };
    try {
      return await fn(loadedMod, ctx);
    } finally {
      ctx.outputSink.out = originalOut;
    }
  } finally {
    // Attempt to close db and underlying dynamic library if present
    if (ctx && ctx.db) {
      // Close the DatabaseService
      if (typeof ctx.db.close === "function") {
        try {
          await ctx.db.close();
        } catch (err) {
          console.error("[withTestMod] Error closing db:", err);
        }
      }
      // Close the underlying Database instance if present
      const dbCandidate = ctx.db as { instance?: { close?: () => Promise<void> | void } } | undefined;
      if (
        dbCandidate &&
        typeof dbCandidate === "object" &&
        "instance" in dbCandidate &&
        typeof dbCandidate.instance === "object" &&
        typeof dbCandidate.instance?.close === "function"
      ) {
        try {
          await dbCandidate.instance.close();
        } catch (err) {
          console.error("[withTestMod] Error closing db.instance:", err);
        }
      }
    }
    if (origEnv === undefined) {
      Deno.env.delete("EXA_TEST_CLI_MODE");
      Deno.env.delete("EXA_TEST_MODE");
    } else {
      Deno.env.set("EXA_TEST_CLI_MODE", origEnv);
      Deno.env.set("EXA_TEST_MODE", origEnv);
    }
    if (configPath) {
      Deno.env.delete("EXA_CONFIG_PATH");
    }
    // Clean up ephemeral config and temp dir
    if (tempDir) {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch (_) {
        // ignore errors during temp dir cleanup
      }
    }
  }
}

/** Runs `fn` as if standard input and standard error were a terminal, so an editor verb does not refuse. */
export async function withTerminal<T>(fn: () => Promise<T>): Promise<T> {
  const stdin = stub(Deno.stdin, "isTerminal", () => true);
  const stderr = stub(Deno.stderr, "isTerminal", () => true);
  try {
    return await fn();
  } finally {
    stdin.restore();
    stderr.restore();
  }
}

/** The pending wait state that `approval cancel` looks up to find the trace of its consent row. */
export function stubWaitState(ctx: ExaCtlTestContext, resumeToken: string): void {
  ctx.waitStateCommands.list = () =>
    Promise.resolve([{
      waitStateId: "ws-stub",
      traceId: "trace-stub",
      kind: "approval",
      status: "pending",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resumeToken,
    }]);
}

export async function captureConsoleOutput(
  fn: () => Promise<void> | void,
  timeoutMs: number = 10000,
): Promise<string> {
  return await captureConsoleOutputShared(fn, timeoutMs);
}

/**
 * Expects the function to call Deno.exit and captures the console.error output.
 */
export async function expectExitWithLogs(
  fn: () => Promise<void> | void,
  timeoutMs: number = 10000,
): Promise<{ err: Error; errors: string[]; exitCalled: boolean }> {
  const origExit = Deno.exit;
  const origErr = console.error;
  const errors: string[] = [];
  let exitCalled = false;
  console.error = (...args: string[]) => errors.push(args.map(String).join(" "));
  Deno.exit = (code?: number) => {
    exitCalled = true;
    throw new Error(`DENO_EXIT:${code ?? 0}`);
  };

  try {
    await runWithTimeout(async () => {
      await fn();
      throw new Error("Expected Deno.exit to be called");
    }, timeoutMs);
  } catch (e: any) {
    if (e instanceof Error) {
      if (!e.message.startsWith("DENO_EXIT:") && !e.message.includes("timed out")) throw e;
      return { err: e, errors, exitCalled };
    }
    throw e;
  } finally {
    console.error = origErr;
    Deno.exit = origExit;
  }
  // This should never be reached, but TypeScript requires it
  throw new Error("Unexpected code path in expectExitWithLogs");
}

/** Runs `fn` and returns the ExaCtlError it throws. The root error handler turns that error into an exit code. */
export async function expectExaCtlError(fn: () => Promise<void> | void): Promise<ExaCtlError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ExaCtlError) return error;
    throw error;
  }
  throw new Error("Expected the function to throw an ExaCtlError");
}

/** The result of a stubbed `request create` for a request that names a flow. */
export function createdFlowRequest(flow: string, traceId: string): IRequest {
  return {
    filename: "/tmp/req.md",
    trace_id: traceId,
    priority: RequestPriority.HIGH,
    flow,
    path: "/tmp",
    source: RequestSource.CLI as const,
    created_by: "tester",
    created: "now",
    status: RequestStatus.PENDING,
    agent_role: "agent",
  };
}
