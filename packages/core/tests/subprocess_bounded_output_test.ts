/**
 * @module SubprocessBoundedOutputTest
 * @path packages/core/tests/subprocess_bounded_output_test.ts
 * @related-files [packages/core/src/helpers/subprocess.ts]
 * @architectural-layer Tests
 * @description `SafeSubprocess.run` with `maxOutputChars` keeps only the tail of each
 *   stream, so a child that prints without limit cannot grow the parent's memory.
 */

import { assert, assertEquals } from "@std/assert";
import { SafeSubprocess } from "@exaix/core";

const END_MARKER = "END-MARKER";
const MEGABYTE = 1 << 20;
const PRINTED_MEGABYTES = 50;
const TAIL_CHARS = 100;

function printScript(target: "stdout" | "stderr"): string {
  return `const chunk = new TextEncoder().encode("x".repeat(${MEGABYTE}));
for (let i = 0; i < ${PRINTED_MEGABYTES}; i++) await Deno.${target}.write(chunk);
await Deno.${target}.write(new TextEncoder().encode("${END_MARKER}"));`;
}

Deno.test("[subprocess] maxOutputChars keeps only the tail of a child that prints 50 MB", async () => {
  const result = await SafeSubprocess.run(Deno.execPath(), ["eval", printScript("stdout")], {
    maxOutputChars: TAIL_CHARS,
    timeoutMs: 60_000,
  });

  assertEquals(result.code, 0);
  assertEquals(result.stdout.length, TAIL_CHARS);
  assert(result.stdout.endsWith(END_MARKER), result.stdout);
});

Deno.test("[subprocess] maxOutputChars bounds stderr the same way", async () => {
  const result = await SafeSubprocess.run(Deno.execPath(), ["eval", printScript("stderr")], {
    maxOutputChars: TAIL_CHARS,
    timeoutMs: 60_000,
  });

  assertEquals(result.stderr.length, TAIL_CHARS);
  assert(result.stderr.endsWith(END_MARKER), result.stderr);
});

Deno.test("[subprocess] without maxOutputChars the full output is returned unchanged", async () => {
  const result = await SafeSubprocess.run(Deno.execPath(), ["eval", `console.log("a".repeat(5000))`]);

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "a".repeat(5000) + "\n");
});

Deno.test("[subprocess] a bounded run still times out", async () => {
  let timedOut = false;
  try {
    await SafeSubprocess.run(Deno.execPath(), ["eval", "await new Promise((r) => setTimeout(r, 10_000))"], {
      maxOutputChars: TAIL_CHARS,
      timeoutMs: 300,
    });
  } catch (error) {
    timedOut = error instanceof Error && error.name === "SubprocessTimeoutError";
  }
  assert(timedOut, "a bounded run must raise SubprocessTimeoutError on timeout");
});
