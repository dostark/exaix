/**
 * @module RequestCharacteristicsFlagTest
 * @path apps/exactl/tests/request_characteristics_flag_test.ts
 * @description Tests that --characteristic CLI flag flows through to frontmatter and metadata.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { RequestCommands } from "../src/commands/request_commands.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { getWorkspaceRequestsDir } from "@exaix/testing";

describe("request --characteristic flag", () => {
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

  it("should store characteristics: [cheapest] in frontmatter when --characteristic cheapest is passed", async () => {
    const result = await requestCommands.create("Test request", { characteristics: ["cheapest"] });
    if (!result.path) throw new Error("Path should be defined");
    const content = await Deno.readTextFile(result.path);
    assertStringIncludes(content, 'characteristics: ["cheapest"]');
    assertEquals(result.characteristics, ["cheapest"]);
  });

  it("should store multiple characteristics when --characteristic is repeated", async () => {
    const result = await requestCommands.create("Test request", {
      characteristics: ["cheapest", "fastest"],
    });
    if (!result.path) throw new Error("Path should be defined");
    const content = await Deno.readTextFile(result.path);
    assertStringIncludes(content, 'characteristics: ["cheapest","fastest"]');
    assertEquals(result.characteristics, ["cheapest", "fastest"]);
  });

  it("should store preferred_provider in frontmatter when --preferred-provider is passed", async () => {
    const result = await requestCommands.create("Test request", { preferred_provider: "anthropic" });
    if (!result.path) throw new Error("Path should be defined");
    const content = await Deno.readTextFile(result.path);
    assertStringIncludes(content, "preferred_provider: anthropic");
    assertEquals(result.preferred_provider, "anthropic");
  });

  it("should store all model intent fields together", async () => {
    const result = await requestCommands.create("Test request", {
      model_size: "L",
      thinking: true,
      effort: "high",
      characteristics: ["cheapest"],
      preferred_provider: "anthropic",
    });
    if (!result.path) throw new Error("Path should be defined");
    const content = await Deno.readTextFile(result.path);
    assertStringIncludes(content, "model_size: L");
    assertStringIncludes(content, "thinking: true");
    assertStringIncludes(content, "effort: high");
    assertStringIncludes(content, 'characteristics: ["cheapest"]');
    assertStringIncludes(content, "preferred_provider: anthropic");
    assertEquals(result.model_size, "L");
    assertEquals(result.thinking, true);
    assertEquals(result.effort, "high");
    assertEquals(result.characteristics, ["cheapest"]);
    assertEquals(result.preferred_provider, "anthropic");
  });

  it("should not set characteristics when not specified", async () => {
    const result = await requestCommands.create("Test request");
    assertEquals(result.characteristics, undefined);
  });
});
