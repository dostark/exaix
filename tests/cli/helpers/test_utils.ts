/**
 * @module CliTestUtils
 * @path tests/cli/helpers/test_utils.ts
 * @description Test utilities for CLI command testing.
 */

import type { ExaCtlTestContext } from "../../../src/cli/exactl.ts";
import type * as ExaCtlModule from "../../../src/cli/exactl.ts";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  captureAllOutputs as captureAllOutputsShared,
  captureConsoleOutput as captureConsoleOutputShared,
  runWithTimeout,
} from "./console_utils.ts";

// Dynamic import required for test module loading (documented in CODE_STYLE.md)
// This must remain a dynamic import because the module is only needed at runtime in test mode.
const exactlModulePromise: Promise<typeof import("../../../src/cli/exactl.ts")> = import("../../../src/cli/exactl.ts");

function loadExaCtlModule(): Promise<typeof import("../../../src/cli/exactl.ts")> {
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
  const configPath: string = join(tempDir, "exa.config.toml");
  const configContent = `
[system]
root = "./"

[paths]
runtime = "./.exa"

[database]
batch_flush_ms = 10
batch_max_size = 10
sqlite.journal_mode = "WAL"
sqlite.foreign_keys = true
sqlite.busy_timeout_ms = 5000

[agents]
default_model = "mock:test"

[models."mock:test"]
provider = "mock"
model = "test"
`;
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
    return await fn(loadedMod, ctx);
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
      const dbAny = ctx.db as unknown;
      if (
        dbAny &&
        typeof dbAny === "object" &&
        "instance" in dbAny &&
        typeof (dbAny as { instance?: unknown }).instance === "object" &&
        typeof (dbAny as { instance?: { close?: unknown } }).instance?.close === "function"
      ) {
        try {
          await (dbAny as { instance: { close: () => Promise<void> } }).instance.close();
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

export async function captureConsoleOutput(
  fn: () => Promise<void> | void,
  timeoutMs: number = 10000,
): Promise<string> {
  return await captureConsoleOutputShared(fn, timeoutMs);
}

export async function captureAllOutputs(
  fn: () => Promise<void> | void,
  timeoutMs: number = 10000,
): Promise<{ logs: string[]; warns: string[]; errs: string[] }> {
  return await captureAllOutputsShared(fn, timeoutMs);
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
  } catch (e: unknown) {
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
