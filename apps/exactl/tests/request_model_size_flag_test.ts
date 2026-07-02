/**
 * @module RequestModelSizeFlagTest
 * @path apps/exactl/tests/request_model_size_flag_test.ts
 * @description Tests that --model-size CLI flag flows through to frontmatter and metadata.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { RequestCommands } from "../src/commands/request_commands.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { getWorkspaceRequestsDir } from "@exaix/testing";

describe("request --model-size flag", () => {
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

  it("should store model_size:S in frontmatter when --model-size S is passed", async () => {
    const result = await requestCommands.create("Test request", { model_size: "S" });
    if (!result.path) throw new Error("Path should be defined");
    const content = await Deno.readTextFile(result.path);
    assertStringIncludes(content, "model_size: S");
    assertEquals(result.model_size, "S");
  });

  it("should store model_size:M in frontmatter when --model-size M is passed", async () => {
    const result = await requestCommands.create("Test request", { model_size: "M" });
    if (!result.path) throw new Error("Path should be defined");
    const content = await Deno.readTextFile(result.path);
    assertStringIncludes(content, "model_size: M");
    assertEquals(result.model_size, "M");
  });

  it("should store model_size:L in frontmatter when --model-size L is passed", async () => {
    const result = await requestCommands.create("Test request", { model_size: "L" });
    if (!result.path) throw new Error("Path should be defined");
    const content = await Deno.readTextFile(result.path);
    assertStringIncludes(content, "model_size: L");
    assertEquals(result.model_size, "L");
  });

  it("should store model_size:XL in frontmatter when --model-size XL is passed", async () => {
    const result = await requestCommands.create("Test request", { model_size: "XL" });
    if (!result.path) throw new Error("Path should be defined");
    const content = await Deno.readTextFile(result.path);
    assertStringIncludes(content, "model_size: XL");
    assertEquals(result.model_size, "XL");
  });

  it("should not set model_size when not specified", async () => {
    const result = await requestCommands.create("Test request");
    assertEquals(result.model_size, undefined);
  });
});
