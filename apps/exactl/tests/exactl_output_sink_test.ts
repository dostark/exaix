/**
 * @module ExaCtlOutputSinkTest
 * @path apps/exactl/tests/exactl_output_sink_test.ts
 * @description Verifies the default output sink writes every byte to a pipe and ends quietly when the reader closes.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/src/output/exactl_output.ts]
 * @related-files [apps/exactl/src/output/exactl_output.ts]
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
const OUTPUT_MODULE = new URL("../src/output/exactl_output.ts", import.meta.url).href;
const PAYLOAD_BYTES = 5_000_000;
const WRITER_SOURCE =
  `import { defaultOutputSink } from "${OUTPUT_MODULE}"; await defaultOutputSink.out("x".repeat(${PAYLOAD_BYTES}) + "\\n");`;

function spawnWriter(): Deno.ChildProcess {
  return new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config", join(REPO_ROOT, "deno.json"), "--allow-all", WRITER_SOURCE],
    stdout: "piped",
    stderr: "piped",
  }).spawn();
}

Deno.test("every byte of a 5 MB payload reaches a pipe reader that reads in small chunks", async () => {
  const child = spawnWriter();
  const reader = child.stdout.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
  }
  const status = await child.status;
  assertEquals(status.code, 0);
  assertEquals(received, PAYLOAD_BYTES + 1);
});

Deno.test("a reader that closes early ends the write without an error or a stack trace", async () => {
  const child = spawnWriter();
  const stderrText = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const first = await reader.read();
  assert(!first.done);
  await reader.cancel();
  const status = await child.status;
  const stderr = await stderrText;
  assertEquals(status.code, 0, stderr);
  assertFalse(/BrokenPipe|stack|at file:/i.test(stderr), stderr);
});
