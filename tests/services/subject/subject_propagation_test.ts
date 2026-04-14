/**
 * @module SubjectPropagationTest
 * @path tests/services/subject/subject_propagation_test.ts
 * @description Integration tests for subject propagation from Request to Plan.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { RequestProcessor } from "../../../src/services/request/request_processor.ts";
import { DatabaseService } from "../../../src/services/core/db.ts";
import type { IGenerateResult, IModelProvider } from "../../../src/ai/types.ts";
import type { Config } from "../../../src/shared/schemas/config.ts";
import { initActivityTableSchema } from "../../helpers/db.ts";
import type { IApplicationContext } from "../../../src/shared/interfaces/i_application_context.ts";
import { createStubConfig, createStubDisplay, createStubGit } from "../../helpers/test_helpers.ts";

interface ISubjectPropagationEnv {
  tempDir: string;
  workspaceDir: string;
  requestsDir: string;
  blueprintsDir: string;
  db: DatabaseService;
  config: Config;
}

async function withSubjectPropagationEnv(
  testFn: (env: ISubjectPropagationEnv) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  const workspaceDir = join(tempDir, "workspace");
  const requestsDir = join(workspaceDir, "Requests");
  const plansDir = join(workspaceDir, "Plans");
  const runtimeDir = join(tempDir, "Runtime");
  const blueprintsDir = join(tempDir, "Blueprints");
  const identitiesDir = join(blueprintsDir, "Identities");

  await Deno.mkdir(requestsDir, { recursive: true });
  await Deno.mkdir(plansDir, { recursive: true });
  await Deno.mkdir(runtimeDir, { recursive: true });
  await Deno.mkdir(identitiesDir, { recursive: true });

  await Deno.writeTextFile(
    join(identitiesDir, "test-agent.md"),
    `---
name: "Test Agent"
identity_id: "test-agent"
description: "Test agent"
---
Follow instructions
`,
  );

  const configRaw = {
    system: { root: tempDir },
    paths: {
      workspace: "workspace",
      requests: "Requests",
      plans: "Plans",
      active: "Active",
      rejected: "Rejected",
      archive: "Archive",
      blueprints: "Blueprints",
      portals: "Portals",
      memory: "Memory",
      runtime: "Runtime",
      flows: "Flows",
    },
    database: {
      batch_flush_ms: 100,
      batch_max_size: 10,
      failure_threshold: 5,
      reset_timeout_ms: 60000,
      half_open_success_threshold: 2,
      sqlite: {
        journal_mode: "WAL",
        foreign_keys: true,
        busy_timeout_ms: 5000,
      },
    },
    portals: [],
    ai: {
      providers: {
        mock: { enabled: true, model: "mock-model" },
      },
      default_provider: "mock",
    },
    quality_gate: { enabled: false },
  } as unknown;
  const config = configRaw as Config;

  const db = new DatabaseService(config);
  initActivityTableSchema(db);

  try {
    await testFn({ tempDir, workspaceDir, requestsDir, blueprintsDir, db, config });
  } finally {
    await db.close();
    await Deno.remove(tempDir, { recursive: true });
  }
}

function makeResult(content: string): IGenerateResult {
  return {
    content,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: "m",
    provider: "p",
    cost_usd: 0,
  };
}

Deno.test("RequestProcessor - Subject Propagation - Agent Upgrades Subject", async () => {
  await withSubjectPropagationEnv(async ({ workspaceDir, requestsDir, blueprintsDir, db, config }) => {
    // Mock LLM Response with a subject
    const agentSubject = "Refactor Database Schema";
    const mockProviderRaw = {
      id: "mock",
      generate: () =>
        Promise.resolve(
          makeResult(`
<thought>I should suggest a better subject.</thought>
<content>
{
  "subject": "${agentSubject}",
  "description": "Comprehensive plan to refactor the database.",
  "steps": [
    {
      "step": 1,
      "title": "Analyze Schema",
      "description": "Analyze existing schema"
    }
  ]
}
</content>`),
        ),
    };
    const mockProvider = (mockProviderRaw as unknown) as IModelProvider;

    const context: IApplicationContext = {
      config: createStubConfig(config),
      db,
      provider: mockProvider,
      git: createStubGit(),
      display: createStubDisplay(db),
    };

    const processor = new RequestProcessor({
      workspacePath: workspaceDir,
      requestsDir: requestsDir,
      blueprintsPath: blueprintsDir,
      includeReasoning: true,
      context,
      testProvider: mockProvider,
    });

    // 1. Create a request with a fallback subject
    const requestId = "request-123";
    const requestFilePath = join(requestsDir, `${requestId}.md`);
    const initialSubject = "Initial Subject";
    await Deno.writeTextFile(
      requestFilePath,
      `---
trace_id: "trace-123"
created: "${new Date().toISOString()}"
status: "pending"
priority: "normal"
identity: "test-agent"
source: RequestSource.CLI
created_by: "user"
subject: "${initialSubject}"
subject_is_fallback: true
---

Fix the database please.`,
    );

    // 2. Process the request
    const planPath = await processor.process(requestFilePath);
    assertExists(planPath);

    // 3. Verify the plan has the agent's subject in frontmatter
    const planContent = await Deno.readTextFile(planPath);
    assertExists(planContent.match(new RegExp(`subject: ${agentSubject}`)));

    // 4. Verify the request file was "upgraded" with the agent's subject
    // StatusManager writes extra fields as quoted strings: subject: "Refactor Database Schema"
    const updatedRequestContent = await Deno.readTextFile(requestFilePath);
    assertExists(updatedRequestContent.match(new RegExp(`subject: "${agentSubject}"`)));
  });
});

Deno.test("RequestProcessor - Subject Propagation - Explicit Subject Wins over Agent", async () => {
  await withSubjectPropagationEnv(async ({ workspaceDir, requestsDir, blueprintsDir, db, config }) => {
    const explicitSubject = "My Custom Subject";
    const agentSubject = "Agent Subject";

    const _mockProviderRaw = {
      id: "mock",
      generate: () =>
        Promise.resolve(
          makeResult(`
<content>
{
  "subject": "${agentSubject}",
  "description": "Desc",
  "steps": [{"step": 1, "title": "S1", "description": "D1"}]
}
</content>`),
        ),
    };
    const mockProvider = (_mockProviderRaw as unknown) as IModelProvider;

    const context: IApplicationContext = {
      config: createStubConfig(config),
      db,
      provider: mockProvider,
      git: createStubGit(),
      display: createStubDisplay(db),
    };

    const processor = new RequestProcessor({
      workspacePath: workspaceDir,
      requestsDir: requestsDir,
      blueprintsPath: blueprintsDir,
      includeReasoning: true,
      context,
      testProvider: mockProvider,
    });

    const requestId = "request-456";
    const requestFilePath = join(requestsDir, `${requestId}.md`);
    await Deno.writeTextFile(
      requestFilePath,
      `---
trace_id: "trace-456"
created: "${new Date().toISOString()}"
status: "pending"
priority: "normal"
identity: "test-agent"
source: RequestSource.CLI
created_by: "user"
subject: "${explicitSubject}"
subject_is_fallback: false
---

Request content.`,
    );

    const planPath = await processor.process(requestFilePath);
    assertExists(planPath);

    // 1. Verify the plan has the EXPLICIT subject in frontmatter, NOT the agent's
    const planContent = await Deno.readTextFile(planPath);
    assertExists(planContent.match(new RegExp(`subject: ${explicitSubject}`)));

    // 2. Verify the request was NOT upgraded (explicit subject wins over agent suggestion)
    const updatedRequestContent = await Deno.readTextFile(requestFilePath);
    assertExists(updatedRequestContent.match(new RegExp(`subject: "${explicitSubject}"`)));
    // Agent's suggested subject should NOT appear
    assertEquals(updatedRequestContent.includes(`subject: "${agentSubject}"`), false);
  });
});
