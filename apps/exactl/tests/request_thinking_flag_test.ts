/**
 * @module RequestThinkingFlagTest
 * @path apps/exactl/tests/request_thinking_flag_test.ts
 * @description Tests that --thinking and --effort CLI flags flow through to frontmatter and metadata.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { RequestCommands } from "../src/commands/request_commands.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { getWorkspaceRequestsDir } from "@exaix/testing";

describe("request --thinking flag", () => {
  let tempDir: string;
  let _db: DatabaseService;
  let requestCommands: RequestCommands;
  let _requestsDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await createCliTestContext({ createDirs: ["Workspace/Requests", "Blueprints/Flows"] });
    tempDir = result.tempDir;
    _db = result.db;
    cleanup = result.cleanup;
    _requestsDir = getWorkspaceRequestsDir(tempDir);
    requestCommands = new RequestCommands(result.context);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should store thinking:true in frontmatter when --thinking is passed", async () => {
    const result = await requestCommands.create("Test request", { thinking: true });
    if (!result.path) throw new Error("Path should be defined");
    const content = await Deno.readTextFile(result.path);
    assertStringIncludes(content, "thinking: true");
    assertEquals(result.thinking, true);
  });

  it("should store effort:high in frontmatter when --effort high is passed", async () => {
    const result = await requestCommands.create("Test request", { effort: "high" });
    if (!result.path) throw new Error("Path should be defined");
    const content = await Deno.readTextFile(result.path);
    assertStringIncludes(content, "effort: high");
    assertEquals(result.effort, "high");
  });

  it("should store both thinking:true and effort:high when both flags are passed", async () => {
    const result = await requestCommands.create("Test request", { thinking: true, effort: "high" });
    if (!result.path) throw new Error("Path should be defined");
    const content = await Deno.readTextFile(result.path);
    assertStringIncludes(content, "thinking: true");
    assertStringIncludes(content, "effort: high");
    assertEquals(result.thinking, true);
    assertEquals(result.effort, "high");
  });

  it("should store effort:low and effort:medium correctly", async () => {
    const resultLow = await requestCommands.create("Test low", { effort: "low" });
    const resultMedium = await requestCommands.create("Test medium", { effort: "medium" });
    assertEquals(resultLow.effort, "low");
    assertEquals(resultMedium.effort, "medium");
  });

  it("should not set thinking or effort when not specified", async () => {
    const result = await requestCommands.create("Test request");
    assertEquals(result.thinking, undefined);
    assertEquals(result.effort, undefined);
  });
});
