/**
 * @module FlowTestContext
 * @path apps/exactl/tests/helpers/flow_test_context.ts
 * @description Builds the CLI test context that the flow command tests share, with a mock provider and an optional exit hook.
 * @architectural-layer Test
 * @dependencies [@std/path, @exaix/testing]
 * @related-files [apps/exactl/tests/flow_commands_test.ts, apps/exactl/tests/flow_bindings_command_test.ts]
 */

import { join } from "@std/path";
import { createMockProvider } from "@exaix/testing";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import { createCliTestContext } from "./test_setup.ts";

/** A CLI context whose `exit` a test can replace, and the cleanup of its workspace. */
export type FlowTestContext = ICliApplicationContext & {
  exit?: (code?: number) => never;
  cleanup: () => Promise<void>;
};

/** A context over a fresh workspace with a mock provider. `exit` runs instead of `Deno.exit`. */
export async function createMockContext(exit?: (code?: number) => never): Promise<FlowTestContext> {
  const { context, cleanup } = await createCliTestContext();
  return {
    ...context,
    provider: createMockProvider([]),
    exit,
    cleanup,
  };
}

/** The flows directory of the context workspace. */
export function getFlowDir(ctx: ICliApplicationContext): string {
  const cfg = ctx.config.getAll();
  return join(cfg.system.root, cfg.paths.flows);
}

/** Collects `console.error` lines and makes `ctx.exit` throw, until `restore` runs. */
export function captureErrorsAndExit(ctx: FlowTestContext): { text: () => string; restore: () => void } {
  let collected = "";
  const original = console.error;
  console.error = (...args: string[]) => {
    collected += args.join(" ") + "\n";
  };
  ctx.exit = (_code?: number) => {
    throw new Error("DENO_EXIT");
  };
  return {
    text: () => collected,
    restore: () => {
      console.error = original;
      ctx.exit = undefined;
    },
  };
}

/** Runs `fn` while `console.log` or `console.error` lines are collected. The console is restored afterwards. */
export async function captureConsole(kind: "log" | "error", fn: () => Promise<void>): Promise<string> {
  let output = "";
  const original = console[kind];
  console[kind] = (...args: string[]) => {
    output += args.map((a) => String(a)).join(" ") + "\n";
  };
  try {
    await fn();
  } finally {
    console[kind] = original;
  }
  return output;
}
