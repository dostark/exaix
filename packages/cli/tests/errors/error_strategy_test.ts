// deno-lint-ignore-file no-explicit-any
/**
 * @module CLIErrorStrategyTest
 * @path tests/cli/error_strategy_test.ts
 * @description Verifies CLI error handling strategies, ensuring stable FailFast vs. Silent
 * behaviors and consistent exit code mapping for terminal users.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { FailFastStrategy, SilentStrategy } from "@exaix/cli/errors/error_strategy.ts";

Deno.test("FailFastStrategy: logs and throws Error", () => {
  const original = console.error;
  const logs: string[] = [];
  console.error = (...args: string[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    const err = new Error("boom");
    assertThrows(
      () => {
        new FailFastStrategy().handle({ commandName: "cmd", error: err });
      },
      Error,
      "boom",
    );

    assertEquals(logs[0], "Error executing cmd:");
    assertEquals(logs[1], "boom");
  } finally {
    console.error = original;
  }
});

Deno.test("FailFastStrategy: logs and throws non-Error", () => {
  const original = console.error;
  const logs: string[] = [];
  console.error = (...args: string[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    let thrown: any;
    try {
      new FailFastStrategy().handle({ commandName: "cmd", error: "nope" });
    } catch (err) {
      thrown = err;
    }

    assertEquals(thrown, "nope");

    assertEquals(logs[0], "Error executing cmd:");
    assertEquals(logs[1], "nope");
  } finally {
    console.error = original;
  }
});

Deno.test("SilentStrategy: suppresses errors", async () => {
  const original = console.error;
  let called = 0;
  console.error = () => {
    called++;
  };

  try {
    await new SilentStrategy().handle({ commandName: "cmd", error: new Error("boom") });
    assertEquals(called, 0);
  } finally {
    console.error = original;
  }
});
