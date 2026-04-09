/**
 * @module FlowNamespaceSchemaTest
 * @path tests/schemas/flow_namespace_schema_test.ts
 * @description Verifies Phase 64 namespace schema parsing, defaults, and backward compatibility.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { type z, ZodError } from "zod";
import { DEFAULT_FLOW_VERSION, DEFAULT_NAMESPACE_MAX_BYTES } from "../../src/shared/constants.ts";
import { DataFormat, FlowInputSource, FlowOutputFormat } from "../../src/shared/enums.ts";
import {
  FlowSchema,
  FlowStepSchema,
  type IFlowNamespaceConfig,
  type IFlowNamespaceEntry,
  type IFlowNamespaceRead,
  type IFlowNamespaceWrite,
  type IFlowStepNamespace,
  ZFlowNamespaceConfig,
  ZFlowNamespaceEntry,
  ZFlowNamespaceRead,
  ZFlowNamespaceWrite,
  ZFlowStepNamespace,
} from "../../src/shared/schemas/flow.ts";

Deno.test("ZFlowNamespaceConfig: applies defaults", () => {
  const parsed = ZFlowNamespaceConfig.parse({ enabled: true });

  assertEquals(parsed.enabled, true);
  assertEquals(parsed.format, "markdown");
  assertEquals(parsed.maxBytes, DEFAULT_NAMESPACE_MAX_BYTES);
});

Deno.test("ZFlowNamespaceConfig: rejects invalid maxBytes", () => {
  assertThrows(
    () => ZFlowNamespaceConfig.parse({ enabled: true, maxBytes: 0 }),
    ZodError,
  );
});

Deno.test("ZFlowNamespaceRead: validates required flag default", () => {
  const parsed = ZFlowNamespaceRead.parse({ key: "review.summary" });

  assertEquals(parsed.key, "review.summary");
  assertEquals(parsed.required, false);
});

Deno.test("ZFlowNamespaceWrite: validates mode default and from binding", () => {
  const parsed = ZFlowNamespaceWrite.parse({ key: "review.summary", from: "summary" });

  assertEquals(parsed.key, "review.summary");
  assertEquals(parsed.from, "summary");
  assertEquals(parsed.mode, "write");
});

Deno.test("ZFlowNamespaceWrite: rejects invalid mode", () => {
  assertThrows(
    () => ZFlowNamespaceWrite.parse({ key: "review.summary", mode: "merge" }),
    ZodError,
  );
});

Deno.test("ZFlowStepNamespace: defaults reads and writes to empty arrays", () => {
  const parsed = ZFlowStepNamespace.parse({});

  assertEquals(parsed.reads, []);
  assertEquals(parsed.writes, []);
});

Deno.test("ZFlowNamespaceEntry: requires string value", () => {
  const parsed = ZFlowNamespaceEntry.parse({
    key: "review.summary",
    value: "Looks good",
    authorStepId: "review",
    updatedAt: "2026-04-08T12:00:00.000Z",
  });

  assertEquals(parsed.value, "Looks good");

  assertThrows(
    () =>
      ZFlowNamespaceEntry.parse({
        key: "review.summary",
        value: { structured: true },
        authorStepId: "review",
        updatedAt: "2026-04-08T12:00:00.000Z",
      }),
    ZodError,
  );
});

Deno.test("FlowSchema: existing flows parse without namespace config", () => {
  const parsed = FlowSchema.parse({
    id: "code-review",
    name: "Code Review",
    description: "Review code changes",
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

  assertEquals(parsed.namespace, undefined);
  assertEquals(parsed.steps[0].namespace, undefined);
});

Deno.test("FlowSchema: parses flow-level and step-level namespace config", () => {
  const parsed = FlowSchema.parse({
    id: "shared-review",
    name: "Shared Review",
    description: "Review with blackboard coordination",
    version: DEFAULT_FLOW_VERSION,
    namespace: {
      enabled: true,
      format: "markdown",
      maxBytes: 8192,
    },
    steps: [
      {
        id: "analyze",
        name: "Analyze",
        identity: "senior-coder",
        input: {
          source: FlowInputSource.REQUEST,
        },
        namespace: {
          reads: [{ key: "request.context", required: true }],
          writes: [{ key: "analysis.summary", from: "summary", mode: "append" }],
        },
      },
    ],
    output: {
      from: ["analyze"],
      format: FlowOutputFormat.MARKDOWN,
    },
  });

  assertEquals(parsed.namespace?.enabled, true);
  assertEquals(parsed.namespace?.maxBytes, 8192);
  assertEquals(parsed.steps[0].namespace?.reads[0].required, true);
  assertEquals(parsed.steps[0].namespace?.writes[0].mode, "append");
});

Deno.test("FlowStepSchema: parses namespace bindings on a step", () => {
  const parsed = FlowStepSchema.parse({
    id: "step-1",
    name: "Step 1",
    identity: "test-agent",
    namespace: {
      reads: [{ key: "review.summary" }],
      writes: [{ key: "review.findings", from: "findings" }],
    },
  });

  assertEquals(parsed.namespace?.reads[0].key, "review.summary");
  assertEquals(parsed.namespace?.writes[0].from, "findings");
});

Deno.test("Flow namespace inferred types are importable from flow.ts", () => {
  const config: IFlowNamespaceConfig = {
    enabled: true,
    format: DataFormat.YAML,
    maxBytes: DEFAULT_NAMESPACE_MAX_BYTES,
  };
  const readBinding: IFlowNamespaceRead = {
    key: "request.context",
    required: true,
  };
  const writeBinding: IFlowNamespaceWrite = {
    key: "analysis.summary",
    from: "summary",
    mode: "write",
  };
  const stepNamespace: IFlowStepNamespace = {
    reads: [readBinding],
    writes: [writeBinding],
  };
  const entry: IFlowNamespaceEntry = {
    key: "analysis.summary",
    value: "Complete",
    authorStepId: "analyze",
    updatedAt: "2026-04-08T12:00:00.000Z",
  };

  type NamespaceConfigInput = z.input<typeof ZFlowNamespaceConfig>;
  const configInput: NamespaceConfigInput = { enabled: true };

  assertEquals(config.format, "yaml");
  assertEquals(stepNamespace.reads.length, 1);
  assertEquals(entry.authorStepId, "analyze");
  assertEquals(configInput.enabled, true);
});
