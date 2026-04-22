/**
 * @module AgentCapabilityTest
 * @path tests/services/agent/agent_capability_test.ts
 * @description Verifies the logic for mapping agent blueprints to runtime capabilities,
 * ensuring tools and context are correctly injected based on agent definitions.
 */

import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { AgentExecutor, type IAgentFileBlueprint } from "../../../src/services/agent/agent_executor.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { EventLogger } from "../../../src/services/core/event_logger.ts";
import { PathResolver } from "../../../src/services/portal/path_resolver.ts";
import { PortalPermissionsService } from "../../../src/services/portal/portal_permissions.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { TEST_MODEL_OPENAI } from "../../config/constants.ts";
import { PROVIDER_OPENAI } from "../../../src/shared/constants.ts";
import { ToolName } from "../../../src/shared/enums.ts";

/**
 * TDD Tests for Agent Capability Differentiation
 * Task 4.1: Read-Only Agent Optimization
 *
 * Tests that AgentExecutor can differentiate between read-only and write-capable agents
 */

describe("AgentExecutor Capability Differentiation", () => {
  let config: Config;
  let executor: AgentExecutor;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const dbService = await initTestDbService();
    cleanup = dbService.cleanup;

    config = createMockConfig(dbService.tempDir);
    const logger = new EventLogger({ db: dbService.db });
    const pathResolver = new PathResolver(config);
    const permissions = new PortalPermissionsService([]);

    executor = new AgentExecutor(
      config,
      dbService.db,
      logger,
      pathResolver,
      permissions,
    );
  });

  afterEach(async () => {
    executor?.dispose();
    if (cleanup) {
      await cleanup();
    }
  });

  describe("requiresGitTracking", () => {
    it("returns false for read-only agents without write capabilities", () => {
      const blueprint: IAgentFileBlueprint = {
        name: "code-analyst",
        model: TEST_MODEL_OPENAI,
        provider: PROVIDER_OPENAI,
        capabilities: [ToolName.READ_FILE, "list_files", "search_code"],
        systemPrompt: "Analyze code",
      };

      const result = executor.requiresGitTracking(blueprint);
      assertEquals(result, false);
    });

    it("returns true for agents with write_file capability", () => {
      const blueprint: IAgentFileBlueprint = {
        name: "feature-developer",
        model: TEST_MODEL_OPENAI,
        provider: PROVIDER_OPENAI,
        capabilities: [ToolName.READ_FILE, ToolName.WRITE_FILE, "list_files"],
        systemPrompt: "Develop features",
      };

      const result = executor.requiresGitTracking(blueprint);
      assertEquals(result, true);
    });

    it("returns true for agents with git_commit capability", () => {
      const blueprint: IAgentFileBlueprint = {
        name: "commit-agent",
        model: "gpt-4o-mini",
        provider: PROVIDER_OPENAI,
        capabilities: [ToolName.READ_FILE, "git_commit"],
        systemPrompt: "Commit changes",
      };

      const result = executor.requiresGitTracking(blueprint);
      assertEquals(result, true);
    });

    it("returns true for agents with git_create_branch capability", () => {
      const blueprint: IAgentFileBlueprint = {
        name: "branch-agent",
        model: TEST_MODEL_OPENAI,
        provider: PROVIDER_OPENAI,
        capabilities: [ToolName.READ_FILE, "git_create_branch"],
        systemPrompt: "Create branches",
      };

      const result = executor.requiresGitTracking(blueprint);
      assertEquals(result, true);
    });

    it("returns true for agents with multiple write capabilities", () => {
      const blueprint: IAgentFileBlueprint = {
        name: "full-developer",
        model: TEST_MODEL_OPENAI,
        provider: PROVIDER_OPENAI,
        capabilities: [ToolName.READ_FILE, ToolName.WRITE_FILE, "git_commit", "git_create_branch"],
        systemPrompt: "Full development",
      };

      const result = executor.requiresGitTracking(blueprint);
      assertEquals(result, true);
    });

    it("returns false for agents with only read capabilities", () => {
      const blueprint: IAgentFileBlueprint = {
        name: "analyzer",
        model: TEST_MODEL_OPENAI,
        provider: PROVIDER_OPENAI,
        capabilities: [ToolName.READ_FILE, "search_code", "list_files", ToolName.GREP_SEARCH],
        systemPrompt: "Analyze and search",
      };

      const result = executor.requiresGitTracking(blueprint);
      assertEquals(result, false);
    });

    it("returns false for agents with empty capabilities", () => {
      const blueprint: IAgentFileBlueprint = {
        name: "minimal-agent",
        model: TEST_MODEL_OPENAI,
        provider: PROVIDER_OPENAI,
        capabilities: [],
        systemPrompt: "Minimal agent",
      };

      const result = executor.requiresGitTracking(blueprint);
      assertEquals(result, false);
    });

    it("is case-sensitive for capability names", () => {
      const blueprint: IAgentFileBlueprint = {
        name: "case-test",
        model: TEST_MODEL_OPENAI,
        provider: PROVIDER_OPENAI,
        capabilities: ["WRITE_FILE", "Write_File"], // Wrong case
        systemPrompt: "Test case sensitivity",
      };

      const result = executor.requiresGitTracking(blueprint);
      assertEquals(result, false); // Should not match wrong case
    });
  });

  describe("isReadOnlyAgent", () => {
    it("returns true for agents without write capabilities", () => {
      const blueprint: IAgentFileBlueprint = {
        name: "reader",
        model: TEST_MODEL_OPENAI,
        provider: PROVIDER_OPENAI,
        capabilities: [ToolName.READ_FILE, "list_files"],
        systemPrompt: "Read only",
      };

      const result = executor.isReadOnlyAgent(blueprint);
      assertEquals(result, true);
    });

    it("returns false for agents with write capabilities", () => {
      const blueprint: IAgentFileBlueprint = {
        name: "writer",
        model: TEST_MODEL_OPENAI,
        provider: PROVIDER_OPENAI,
        capabilities: [ToolName.READ_FILE, ToolName.WRITE_FILE],
        systemPrompt: "Read and write",
      };

      const result = executor.isReadOnlyAgent(blueprint);
      assertEquals(result, false);
    });
  });
});
