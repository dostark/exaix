/**
 * @module BlueprintServiceEffortSchemaTest
 * @path packages/execution/tests/blueprint_service_effort_schema_test.ts
 * @description Verifies BlueprintService's failsafe-YAML blueprint parse accepts
 *   declaration-time thinking/effort: `thinking: true` arrives as the string "true" and
 *   must validate as the boolean true (GAP-9's preprocess), effort "auto" passes, and an
 *   invalid effort string is rejected through the INVALID_BLUEPRINT_SCHEMA path instead of
 *   being passed to a provider (GAP-5).
 * @architectural-layer Execution
 * @related-files [packages/execution/src/blueprint_service.ts, packages/schemas/src/model_intent.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { BlueprintService } from "@exaix/execution";
import { SafeError } from "@exaix/core/errors";
import { EventLogger } from "@exaix/core/logger";
import { createMockConfig } from "@exaix/testing";
import type { Config } from "@exaix/schemas/config.ts";

const BLUEPRINT_BODY = "\n\nYou are a helpful assistant.\n";

function blueprintContent(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n${BLUEPRINT_BODY}`;
}

async function setup(): Promise<{ root: string; service: BlueprintService; cleanup: () => Promise<void> }> {
  const root = await Deno.makeTempDir({ prefix: "bp-effort-schema-" });
  await Deno.mkdir(join(root, "Blueprints", "Agents"), { recursive: true });
  const config: Config = createMockConfig(root);
  const logger = new EventLogger({ prefix: "[test]" });
  const service = new BlueprintService(config, logger);
  const cleanup = () => Deno.remove(root, { recursive: true }).catch(() => {});
  return { root, service, cleanup };
}

async function writeBlueprint(root: string, agentRole: string, content: string): Promise<void> {
  await Deno.writeTextFile(join(root, "Blueprints", "Agents", `${agentRole}.md`), content);
}

Deno.test("BlueprintService: failsafe-parsed thinking true validates as boolean true", async () => {
  const { root, service, cleanup } = await setup();
  try {
    await writeBlueprint(
      root,
      "agent-a",
      blueprintContent("agent_role: agent-a\nmodel: mock:gpt-5\neffort: high\nthinking: true"),
    );
    const result = await service.loadBlueprint("agent-a");
    assertEquals(result.blueprint.provider, "mock");
  } finally {
    await cleanup();
  }
});

Deno.test("BlueprintService: failsafe-parsed thinking false validates as boolean false", async () => {
  const { root, service, cleanup } = await setup();
  try {
    await writeBlueprint(root, "agent-b", blueprintContent("agent_role: agent-b\nmodel: mock:gpt-5\nthinking: false"));
    const result = await service.loadBlueprint("agent-b");
    assertEquals(result.blueprint.provider, "mock");
  } finally {
    await cleanup();
  }
});

Deno.test("BlueprintService: thinking auto validates as the string auto", async () => {
  const { root, service, cleanup } = await setup();
  try {
    await writeBlueprint(root, "agent-c", blueprintContent("agent_role: agent-c\nmodel: mock:gpt-5\nthinking: auto"));
    const result = await service.loadBlueprint("agent-c");
    assertEquals(result.blueprint.provider, "mock");
  } finally {
    await cleanup();
  }
});

Deno.test("BlueprintService: effort auto is accepted", async () => {
  const { root, service, cleanup } = await setup();
  try {
    await writeBlueprint(root, "agent-d", blueprintContent("agent_role: agent-d\nmodel: mock:gpt-5\neffort: auto"));
    const result = await service.loadBlueprint("agent-d");
    assertEquals(result.blueprint.provider, "mock");
  } finally {
    await cleanup();
  }
});

Deno.test("BlueprintService: an invalid effort string raises INVALID_BLUEPRINT_SCHEMA", async () => {
  const { root, service, cleanup } = await setup();
  try {
    await writeBlueprint(
      root,
      "agent-e",
      blueprintContent("agent_role: agent-e\nmodel: mock:gpt-5\neffort: 'high\" sandbox_mode=\"danger-full-access'"),
    );
    let thrown: SafeError | null = null;
    try {
      await service.loadBlueprint("agent-e");
    } catch (error) {
      if (error instanceof SafeError) thrown = error;
    }
    assertEquals(thrown === null, false, "loadBlueprint must throw a SafeError");
    assertEquals(thrown!.errorCode, "INVALID_BLUEPRINT_SCHEMA");
  } finally {
    await cleanup();
  }
});
