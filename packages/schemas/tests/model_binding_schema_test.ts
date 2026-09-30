/**
 * @module ModelBindingSchemaTest
 * @path packages/schemas/tests/model_binding_schema_test.ts
 * @description Checks the binding input and lock schemas and legacy config compatibility.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { FlowStepSchema } from "@exaix/schemas/flow.ts";
import {
  BindingCatalogSchema,
  BindingLockSchema,
  BindingSpecSchema,
  BindingsTableSchema,
  RunBindingsFileSchema,
} from "@exaix/schemas/model_binding.ts";

Deno.test("binding schemas accept documented partial bindings and reject unknown fields", () => {
  assertEquals(BindingSpecSchema.parse({ service: "mock", model: "openai/gpt-6-luna" }).service, "mock");
  assertEquals(BindingSpecSchema.parse({ effort: "high", thinking: true }).effort, "high");
  assertThrows(() => BindingSpecSchema.parse({ service: "mock", secret: "key" }));
  assertThrows(() => BindingSpecSchema.parse({ service: "../escape" }));
  assertThrows(() => BindingSpecSchema.parse({ model: "missing-provider" }));
});

Deno.test("binding selector and catalog schemas validate ids and source facts", () => {
  assertEquals(BindingsTableSchema.parse({ default: { service: "mock" } }).default.service, "mock");
  assertEquals(
    BindingsTableSchema.parse({ "flow:research/step:compose": { model: "openai/gpt-6-luna" } })[
      "flow:research/step:compose"
    ].model,
    "openai/gpt-6-luna",
  );
  assertThrows(() => BindingsTableSchema.parse({ "flow:../escape": { service: "mock" } }));
  const catalog = BindingCatalogSchema.parse({
    models: { "openai/gpt-6-luna": { model_provider: "openai" } },
    services: {
      local: { adapter: "mock", transport: "local", interface: "api", serves: {} },
    },
  });
  assertEquals(catalog.models?.["openai/gpt-6-luna"].capabilities, undefined);
  assertThrows(() => BindingCatalogSchema.parse({ services: { "../escape": {} } }));
});

Deno.test("binding lock and run schemas initialize in dependency order", () => {
  const trace = "00000000-0000-4000-8000-000000000204";
  const lock = BindingLockSchema.parse({
    schema: 1,
    trace_id: trace,
    flow_id: "research",
    created_at: "2026-09-30T00:00:00.000Z",
    flow_content_sha256: "a".repeat(64),
    pin_sha256: "b".repeat(64),
    catalog_sha256: "c".repeat(64),
    step_ids: ["compose"],
    config_checksum: "config",
    overlay_sha256: [],
    run_overlays: 0,
    env_ignored: false,
    hosts: [],
    entries: [{ step_id: "compose", agent_role: "composer", outcome: { kind: "unbound" } }],
  });
  assertEquals(
    RunBindingsFileSchema.parse({
      schema: 1,
      trace_id: trace,
      request_path: "/tmp/Workspace/Requests/request.md",
      request_sha256: "d".repeat(64),
      created_at: "2026-09-30T00:00:00.000Z",
      overlays: [],
      binds: [],
      locked: lock,
    }).locked?.flow_id,
    "research",
  );
});

Deno.test("legacy config and flow steps retain absent binding fields", () => {
  const config = ConfigSchema.parse({ system: {}, paths: {} });
  assertEquals(config.bindings, undefined);
  assertEquals(config.catalog, undefined);
  const step = FlowStepSchema.parse({ id: "compose", name: "Compose", agent_role: "composer" });
  assertEquals(step.id, "compose");
});
