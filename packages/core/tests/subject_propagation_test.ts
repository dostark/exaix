// deno-lint-ignore-file no-explicit-any
/**
 * @module SubjectPropagationTest
 * @path packages/core/tests/subject_propagation_test.ts
 * @description Integration tests for subject propagation from Request to Plan.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { RequestProcessor } from "@exaix/request";
import { AgentRunner } from "@exaix/execution";
import { DatabaseService } from "@exaix/storage-sqlite";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { initActivityTableSchema } from "@exaix/testing";
import type { IApplicationContext } from "@exaix/core/types";
import { createStubConfig, createStubDisplay, createStubGit } from "@exaix/testing";
import { makeGenerateResult as makeResult } from "@exaix/testing";

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
  const agentRolesDir = join(blueprintsDir, "Agents");

  await Deno.mkdir(requestsDir, { recursive: true });
  await Deno.mkdir(plansDir, { recursive: true });
  await Deno.mkdir(runtimeDir, { recursive: true });
  await Deno.mkdir(agentRolesDir, { recursive: true });

  await Deno.writeTextFile(
    join(agentRolesDir, "test-agent.md"),
    `---
name: "Test Agent"
agent_role: "test-agent"
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
      flows: "Blueprints/Flows",
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
  } as any;
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

Deno.test("RequestProcessor - Subject Propagation - request subject is never upgraded to the agent's", async () => {
  await withSubjectPropagationEnv(async ({ workspaceDir, requestsDir, blueprintsDir, db, config }) => {
    // The agent suggests its own plan name, but rule 3 says the request subject is authoritative
    // and is never overwritten by the agent's plan title — not even when it was a fallback.
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
    const mockProvider = (mockProviderRaw as any) as IModelProvider;

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
      agentRunner: new AgentRunner(mockProvider),
    });

    // 1. Create a request whose subject was auto-derived (no explicit user subject)
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
agent_role: "test-agent"
source: RequestSource.CLI
created_by: "user"
subject: "${initialSubject}"
---

Fix the database please.`,
    );

    // 2. Process the request
    const planPath = await processor.process(requestFilePath);
    assertExists(planPath);

    // 3. The plan's frontmatter subject is the REQUEST's subject, not the agent's plan title.
    const planContent = await Deno.readTextFile(planPath);
    assertExists(planContent.match(new RegExp(`subject: ${initialSubject}`)));
    assertEquals(planContent.includes(`subject: ${agentSubject}`), false);
    // The agent's name still appears as the plan's own title (H1), kept distinct from subject.
    assertExists(planContent.match(new RegExp(`# ${agentSubject}`)));

    // 4. The request file's subject is NOT upgraded — it stays exactly what the request had.
    const updatedRequestContent = await Deno.readTextFile(requestFilePath);
    assertExists(updatedRequestContent.match(new RegExp(`subject: "${initialSubject}"`)));
    assertEquals(updatedRequestContent.includes(`subject: "${agentSubject}"`), false);
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
    const mockProvider = (_mockProviderRaw as any) as IModelProvider;

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
      agentRunner: new AgentRunner(mockProvider),
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
agent_role: "test-agent"
source: RequestSource.CLI
created_by: "user"
subject: "${explicitSubject}"
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
