/**
 * @module FlowTestContext
 * @path apps/exactl/tests/helpers/flow_test_context.ts
 * @description Builds the CLI test context that the flow command tests share, with a mock provider.
 * @architectural-layer Test
 * @dependencies [@std/path, @exaix/testing]
 * @related-files [apps/exactl/tests/flow_commands_test.ts, apps/exactl/tests/flow_bindings_command_test.ts]
 */

import { join } from "@std/path";
import { createMockProvider } from "@exaix/testing";
import type { ICliApplicationContext } from "@exaix/cli/types/cli_context.ts";
import { createCliTestContext } from "./test_setup.ts";

/** A CLI context and the cleanup of its workspace. */
export type FlowTestContext = ICliApplicationContext & {
  cleanup: () => Promise<void>;
};

/** A context over a fresh workspace with a mock provider. */
export async function createMockContext(): Promise<FlowTestContext> {
  const { context, cleanup } = await createCliTestContext();
  return {
    ...context,
    provider: createMockProvider([]),
    cleanup,
  };
}

/** The flows directory of the context workspace. */
export function getFlowDir(ctx: ICliApplicationContext): string {
  const cfg = ctx.config.getAll();
  return join(cfg.system.root, cfg.paths.flows);
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
