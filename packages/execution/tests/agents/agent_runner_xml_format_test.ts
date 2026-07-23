/**
 * @module AgentRunnerXmlFormatTest
 * @path packages/execution/tests/agents/agent_runner_xml_format_test.ts
 * @description Tests that AgentRunner injects the XML response-contract variant when the
 *   provider is opencode CLI (no native JSON support). The JSON variant is kept for
 *   claude-code providers with --json-schema enforcement.
 * @architectural-layer Test
 * @related-files [packages/execution/src/agent_runner.ts]
 */

import { assertStringIncludes } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import { AgentRunner, type IBlueprint, type IParsedRequest } from "@exaix/execution";
import type { ISkillsService } from "@exaix/core/types";
import type { IGenerateResult } from "@exaix/ai/providers";
import { MemoryBankSource, MemoryScope, SkillStatus } from "@exaix/core";

const sampleBlueprint: IBlueprint = {
  systemPrompt: "You are a helpful coding assistant.",
};

const sampleRequest: IParsedRequest = {
  userPrompt: "Add a feature",
  context: {},
};

const wellFormedResponse = `<thought>OK</thought><content>{"title":"t","description":"d","steps":[]}</content>`;

const XML_SKILL_ID = "550e8400-e29b-41d4-a716-446655440013";

const XML_SKILL_INSTRUCTIONS = `<content> must use XML format with <plan>, <step>, <tool>, and <params> tags.
Do NOT use JSON. The first character after <content> MUST be <.`;

const JSON_SKILL_INSTRUCTIONS = `<content> must be a valid JSON object`;

function createMockSkill(id: string, skillId: string, name: string, instructions: string) {
  return {
    id,
    skill_id: skillId,
    name,
    version: "1.0.0",
    description: name,
    instructions,
    created_at: "2026-07-23T00:00:00.000Z",
    usage_count: 0,
    source: MemoryBankSource.CORE,
    scope: MemoryScope.GLOBAL,
    status: SkillStatus.ACTIVE,
    triggers: { tags: ["response-contract", "output-format"], keywords: [], task_types: [], file_patterns: [] },
    critical: true,
  };
}

class MockSkillsServiceXmlAware implements ISkillsService {
  matchSkills(): Promise<
    { matches: { skillId: string; confidence: number; matchedTriggers: { tags: string[] } }[]; totalAvailable: number }
  > {
    return Promise.resolve({
      matches: [{
        skillId: "response-contract",
        confidence: 1.0,
        matchedTriggers: { tags: ["response-contract", "output-format"] },
      }],
      totalAvailable: 1,
    });
  }
  buildSkillContext(_skillIds: string[]): Promise<string> {
    return Promise.resolve("");
  }
  recordSkillUsage(_skillId: string): Promise<void> {
    return Promise.resolve();
  }
  deriveSkillFromLearnings(): Promise<ReturnType<typeof createMockSkill>> {
    return Promise.resolve(createMockSkill("mock", "mock", "Mock", ""));
  }
  rebuildIndex(): Promise<void> {
    return Promise.resolve();
  }
  listSkills(): Promise<never[]> {
    return Promise.resolve([]);
  }
  initialize(): Promise<void> {
    return Promise.resolve();
  }
  createSkill(): Promise<ReturnType<typeof createMockSkill>> {
    return Promise.resolve(createMockSkill("mock", "mock", "Mock", ""));
  }
  getSkill(id: string): Promise<ReturnType<typeof createMockSkill> | null> {
    if (id === XML_SKILL_ID) {
      return Promise.resolve(
        createMockSkill(id, "response-contract-xml", "Response Output Contract (XML/Markdown)", XML_SKILL_INSTRUCTIONS),
      );
    }
    return Promise.resolve(
      createMockSkill("default", "response-contract", "Response Output Contract", JSON_SKILL_INSTRUCTIONS),
    );
  }
  deleteSkill(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

Deno.test("[AgentRunner] opencode CLI provider injects XML format instructions in the prompt", async () => {
  let capturedPrompt = "";
  const mockProvider = new MockProvider(wellFormedResponse, "opencode-cli-opencode-go/deepseek-v4-flash");
  const originalGenerate = mockProvider.generate.bind(mockProvider);
  mockProvider.generate = async (prompt: string): Promise<IGenerateResult> => {
    capturedPrompt = prompt;
    return await originalGenerate(prompt);
  };

  const runner = new AgentRunner(mockProvider, {
    skillsService: new MockSkillsServiceXmlAware(),
  });
  await runner.run(sampleBlueprint, sampleRequest, undefined);

  assertStringIncludes(capturedPrompt, "<plan>");
  assertStringIncludes(capturedPrompt, "<step");
  assertStringIncludes(capturedPrompt, "<tool>");
});

Deno.test("[AgentRunner] claude-code provider keeps JSON format instructions", async () => {
  let capturedPrompt = "";
  const mockProvider = new MockProvider(wellFormedResponse, "claude-code-claude-sonnet-5");
  const originalGenerate = mockProvider.generate.bind(mockProvider);
  mockProvider.generate = async (prompt: string): Promise<IGenerateResult> => {
    capturedPrompt = prompt;
    return await originalGenerate(prompt);
  };

  const runner = new AgentRunner(mockProvider, {
    skillsService: new MockSkillsServiceXmlAware(),
  });
  await runner.run(sampleBlueprint, sampleRequest, undefined);

  assertStringIncludes(capturedPrompt, "JSON object");
});
