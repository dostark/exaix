/**
 * @module GoPortBenchmarkTest
 * @path tests/scripts/go_port_benchmark_test.ts
 * @description Validates benchmark aggregation, the evidence schema and unavailable-mode handling.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [scripts/go_port/benchmark.ts]
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { parseMaxRss, summarize, validateBenchmarks } from "../../scripts/go_port/benchmark.ts";

const MODES = [
  { mode: "deno-source", condition: "cold", samples: [10, 11, 12, 13, 14], max_rss_kb: 1, binary_bytes: null },
  { mode: "deno-compiled", condition: "warm", samples: [5, 6, 7, 8, 9], max_rss_kb: 2, binary_bytes: 100 },
  { mode: "go-slice", condition: "warm", samples: [1, 2, 3, 4, 5], max_rss_kb: 3, binary_bytes: 200 },
];

Deno.test("benchmark-warm-cold: five samples produce median and p95", () => {
  assertEquals(summarize([10, 11, 12, 13, 14]), { median: 12, p95: 14 });
  assertEquals(summarize([5]), { median: 5, p95: 5 });
  assertThrows(() => summarize([]), Error, "empty");
});

Deno.test("benchmark-schema: a missing mode, sample or host fails", () => {
  assertThrows(() => validateBenchmarks({ host: "x", versions: {}, modes: [] }), Error, "modes");
  assertThrows(() => validateBenchmarks({ host: "", versions: {}, modes: MODES }), Error, "host");
  assertThrows(
    () => validateBenchmarks({ host: "x", versions: {}, modes: [{ ...MODES[0], samples: [] }] }),
    Error,
    "samples",
  );
  assertEquals(validateBenchmarks({ host: "x", versions: { deno: "2" }, modes: MODES }), []);
});

Deno.test("benchmark-unavailable: an unavailable mode is explicit", () => {
  assertEquals(validateBenchmarks({ host: "x", versions: {}, modes: MODES, unavailable: ["go-config-show"] }), []);
  assertThrows(
    () => validateBenchmarks({ host: "x", versions: {}, modes: MODES, unavailable: [1] as never }),
    Error,
    "unavailable",
  );
});

Deno.test("benchmark-rss: /usr/bin/time maximum RSS is parsed", () => {
  assertEquals(parseMaxRss("Maximum resident set size (kbytes): 1234"), 1234);
  assertEquals(parseMaxRss("no rss"), null);
});

Deno.test("benchmark-real: the committed evidence has every mode and condition", async () => {
  const evidence = JSON.parse(
    await Deno.readTextFile(new URL("../../exaix-dev-docs/evidence/go-port/benchmarks.json", import.meta.url)),
  ) as { host: string; modes: { mode: string; condition: string }[]; unavailable: string[] };
  assertStringIncludes(evidence.host, "/");
  assertEquals(evidence.modes.length, 6);
  assertStringIncludes(evidence.unavailable.join(","), "go-config-show");
});
