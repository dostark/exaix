/**
 * @module ParallelGroupSchemaTest
 * @path tests/flows/parallel_group_schema_test.ts
 * @description Verifies Phase 65 parallel group schema parsing and backward compatibility.
 * @architectural-layer Tests
 * @related-files ["packages/schemas/src/flow.ts"]
 */

import { assertEquals } from "@std/assert";
import { DEFAULT_FLOW_VERSION } from "@exaix/core";
import { FlowInputSource, FlowOutputFormat } from "@exaix/core";
import { FlowSchema, FlowStepSchema, ZFlowParallelConfig, ZParallelMergeMode } from "@exaix/schemas/flow.ts";

Deno.test("ZFlowParallelConfig: applies merge defaults", () => {
  const parsed = ZFlowParallelConfig.parse({ group: "reviewers" });

  assertEquals(parsed.group, "reviewers");
  assertEquals(parsed.mergeMode, ZParallelMergeMode.enum.all);
  assertEquals(parsed.order, undefined);
});

Deno.test("FlowStepSchema: parses parallel group and merge fields", () => {
  const parsed = FlowStepSchema.parse({
    id: "review-a",
    name: "Review A",
    identity: "qa-engineer",
    input: {
      source: FlowInputSource.REQUEST,
    },
    parallel: {
      group: "reviewers",
      mergeMode: "ordered",
      order: ["review-a", "review-b"],
    },
    mergeFromGroups: ["reviewers"],
    mergeMode: "concat",
  });

  assertEquals(parsed.parallel?.group, "reviewers");
  assertEquals(parsed.parallel?.mergeMode, "ordered");
  assertEquals(parsed.parallel?.order, ["review-a", "review-b"]);
  assertEquals(parsed.mergeFromGroups, ["reviewers"]);
  assertEquals(parsed.mergeMode, "concat");
});

Deno.test("FlowSchema: existing flows parse without parallel metadata", () => {
  const parsed = FlowSchema.parse({
    id: "legacy-flow",
    name: "Legacy Flow",
    description: "Legacy flow without explicit groups",
    version: DEFAULT_FLOW_VERSION,
    steps: [
      {
        id: "review",
        name: "Review",
        identity: "senior-coder",
      },
    ],
    output: {
      from: ["review"],
      format: FlowOutputFormat.MARKDOWN,
    },
  });

  assertEquals(parsed.steps[0].parallel, undefined);
  assertEquals(parsed.steps[0].mergeFromGroups, undefined);
  assertEquals(parsed.steps[0].mergeMode, undefined);
});
