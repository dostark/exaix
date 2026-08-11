/**
 * @module SpliceRequestFixtureSentinelTest
 * @path tests/scenario_framework/tests/unit/splice_request_fixture_sentinel_test.ts
 * @description RED-first test, Phase 144 post-gap remediation (GAP-8 / Step 14). The `-p`
 *   sentinel-splice logic (insert `REQUEST_FIXTURE_CONTENT_SENTINEL` immediately after a `-p`
 *   flag when present — claude's `-p` requires the prompt as the argument immediately after
 *   it — or append it when absent) was duplicated verbatim between `matrix_expander.ts` and
 *   `scenario_templates.ts`. Exercises the extracted shared helper directly.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts, tests/scenario_framework/runner/scenario_templates.ts]
 */

import { assertEquals } from "@std/assert";
import { REQUEST_FIXTURE_CONTENT_SENTINEL, spliceRequestFixtureSentinel } from "../../runner/matrix_expander.ts";

Deno.test("[SpliceRequestFixtureSentinel] inserts the sentinel immediately after a -p flag, not at the end", () => {
  const result = spliceRequestFixtureSentinel(["-p", "--output-format", "json"]);
  assertEquals(result, ["-p", REQUEST_FIXTURE_CONTENT_SENTINEL, "--output-format", "json"]);
});

Deno.test("[SpliceRequestFixtureSentinel] appends the sentinel at the end when no -p flag is present", () => {
  const result = spliceRequestFixtureSentinel(["run", "--format", "json"]);
  assertEquals(result, ["run", "--format", "json", REQUEST_FIXTURE_CONTENT_SENTINEL]);
});

Deno.test("[SpliceRequestFixtureSentinel] does not mutate the input array", () => {
  const input = ["-p"];
  spliceRequestFixtureSentinel(input);
  assertEquals(input, ["-p"]);
});
