/**
 * @module BlueprintServiceToolNamesTest
 * @path packages/execution/tests/blueprint_service_tool_names_test.ts
 * @description Verifies BlueprintSchema.permitted_tools accepts exact native tool names and
 *   supported general-purpose aliases (Read, grep), rejects list_symbols and native
 *   case/whitespace variants, preserves unrelated custom names, and distinguishes an absent
 *   permitted_tools from an explicit empty array (Phase 201 Step 3, fourth-review GAP-2).
 * @architectural-layer Execution
 * @related-files [packages/execution/src/blueprint_service.ts, packages/core/src/types/tool_aliases.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { BlueprintService } from "@exaix/execution";
import { SafeError } from "@exaix/core/errors";
import { EventLogger } from "@exaix/core/logger";
import { createMockConfig } from "@exaix/testing";
import { ToolName } from "@exaix/core";
import type { Config } from "@exaix/schemas/config.ts";

const BLUEPRINT_BODY = "\n\nYou are a helpful assistant.\n";

function blueprintContent(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n${BLUEPRINT_BODY}`;
}

async function setup(): Promise<{ root: string; service: BlueprintService; cleanup: () => Promise<void> }> {
  const root = await Deno.makeTempDir({ prefix: "bp-tool-names-" });
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

function toolsFrontmatter(agentRole: string, tools: string): string {
  return `agent_role: ${agentRole}\nmodel: mock:gpt-5\npermitted_tools: [${tools}]`;
}

Deno.test("[blueprint_service] accepts exact native names and general-purpose Read/grep", async () => {
  const { root, service, cleanup } = await setup();
  try {
    await writeBlueprint(
      root,
      "agent-native",
      blueprintContent(toolsFrontmatter("agent-native", `${ToolName.QUERY_SYMBOLS}, Read, grep`)),
    );
    const result = await service.loadBlueprint("agent-native");
    assertEquals(result.blueprint.permitted_tools, [ToolName.QUERY_SYMBOLS, "Read", "grep"]);
  } finally {
    await cleanup();
  }
});

Deno.test("[blueprint_service] rejects list_symbols", async () => {
  const { root, service, cleanup } = await setup();
  try {
    await writeBlueprint(root, "agent-retired", blueprintContent(toolsFrontmatter("agent-retired", "list_symbols")));
    await assertRejects(
      () => service.loadBlueprint("agent-retired"),
      SafeError,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[blueprint_service] rejects a native case/whitespace variant", async () => {
  const { root, service, cleanup } = await setup();
  try {
    await writeBlueprint(
      root,
      "agent-case",
      blueprintContent(toolsFrontmatter("agent-case", "Query_Symbols")),
    );
    await assertRejects(
      () => service.loadBlueprint("agent-case"),
      SafeError,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[blueprint_service] preserves an unrelated custom tool name", async () => {
  const { root, service, cleanup } = await setup();
  try {
    await writeBlueprint(
      root,
      "agent-custom",
      blueprintContent(toolsFrontmatter("agent-custom", "my_custom_tool")),
    );
    const result = await service.loadBlueprint("agent-custom");
    assertEquals(result.blueprint.permitted_tools, ["my_custom_tool"]);
  } finally {
    await cleanup();
  }
});

Deno.test("[naming] rejects who_depends_on and deno_task after the Step 4 rename; grep_search stays accepted as a raw alias", async () => {
  const { root, service, cleanup } = await setup();
  try {
    await writeBlueprint(
      root,
      "agent-grep",
      blueprintContent(toolsFrontmatter("agent-grep", "grep_search")),
    );
    const result = await service.loadBlueprint("agent-grep");
    assertEquals(result.blueprint.permitted_tools, ["grep_search"]);

    for (const tool of ["who_depends_on", " WHO_DEPENDS_ON ", "deno_task", " DENO_TASK "]) {
      await writeBlueprint(root, "agent-native", blueprintContent(toolsFrontmatter("agent-native", tool)));
      await assertRejects(() => service.loadBlueprint("agent-native"), SafeError);
    }
    for (const tool of ["find_dependents", "run_deno_task"]) {
      await writeBlueprint(root, "agent-current", blueprintContent(toolsFrontmatter("agent-current", tool)));
      assertEquals((await service.loadBlueprint("agent-current")).blueprint.permitted_tools, [tool]);
    }
  } finally {
    await cleanup();
  }
});

Deno.test("[blueprint_service] distinguishes undefined permitted_tools from an explicit empty array", async () => {
  const { root, service, cleanup } = await setup();
  try {
    await writeBlueprint(root, "agent-undef", blueprintContent("agent_role: agent-undef\nmodel: mock:gpt-5"));
    await writeBlueprint(root, "agent-empty", blueprintContent(toolsFrontmatter("agent-empty", "")));
    const undef = await service.loadBlueprint("agent-undef");
    const empty = await service.loadBlueprint("agent-empty");
    assertEquals(undef.blueprint.permitted_tools, undefined);
    assertEquals(empty.blueprint.permitted_tools, []);
  } finally {
    await cleanup();
  }
});
