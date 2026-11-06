/**
 * @module FlowSkillDeliveryFixture
 * @path tests/integration/helpers/flow_skill_delivery_fixture.ts
 * @description Builds real flow, skill, and CLI transport collaborators with a captured subprocess boundary.
 * @architectural-layer Test
 * @related-files [packages/flow/src/agent_composer_adapter.ts, packages/execution/src/skill_pin_transport.ts]
 */
import { CliDelegateConfigSchema } from "@exaix/schemas/session_delegate.ts";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { ExecutionStrategyName } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { SkillsService } from "@exaix/core/skills";
import { AgentComposerAdapter } from "@exaix/flow";
import type { IFlowStepRequest } from "@exaix/flow";
import { PortalPermissionsService } from "@exaix/portal";
import { createMockConfig, initTestDbService, REPO_ROOT } from "@exaix/testing";
import type { IRunCliDelegateProcess } from "@exaix/execution";

export interface IFlowSkillUsage {
  skill_name: string;
  revision_id: string;
  flow_id: string;
  flow_step_id: string;
  root_kind: string;
  source_path: string;
  agent_role: string;
  trace_id: string;
  request_id: string;
  match_source: string;
}

interface IFlowSkillDeliveryFixture {
  env: Awaited<ReturnType<typeof initTestDbService>>;
  config: ReturnType<typeof createMockConfig>;
  skills: SkillsService;
  adapter: AgentComposerAdapter;
  launches: Array<{ objective: string; usage: IFlowSkillUsage[] }>;
  rows: () => Promise<IFlowSkillUsage[]>;
  request: (skills: string[]) => IFlowStepRequest;
  execute: (role: string, request: IFlowStepRequest) => ReturnType<AgentComposerAdapter["runWithStrategy"]>;
  cleanup: () => Promise<void>;
}

/** Owns all filesystem and database state used by one delivery test. */
export async function flowSkillDeliveryFixture(): Promise<IFlowSkillDeliveryFixture> {
  const env = await initTestDbService();
  await copy(join(REPO_ROOT, "Blueprints"), join(env.tempDir, "Blueprints"));
  const config = createMockConfig(env.tempDir);
  config.portals = [{
    alias: "project",
    target_path: env.tempDir,
    agents_allowed: ["*"],
    operations: [],
    default_branch: "main",
  }];
  config.cli_delegate = CliDelegateConfigSchema.parse({ enabled: true, tool: "claude-code" });
  const logger = new EventLogger({ db: env.db });
  const skills = new SkillsService(
    { memoryDir: join(env.tempDir, "Memory"), blueprintSkillsDir: join(env.tempDir, "Blueprints", "Skills") },
    env.db,
    undefined,
    logger,
  );
  const rows = async () => {
    await env.db.waitForFlush();
    return await env.db.preparedAll<IFlowSkillUsage>(
      "SELECT skill_name, revision_id, flow_id, flow_step_id, root_kind, source_path, agent_role, trace_id, request_id, match_source FROM skill_usage ORDER BY id",
    );
  };
  const launches: Array<{ objective: string; usage: IFlowSkillUsage[] }> = [];
  const run: IRunCliDelegateProcess = async (_command, args) => {
    launches.push({ objective: args[1], usage: await rows() });
    return {
      code: 0,
      stdout: JSON.stringify({
        type: "result",
        result: `<thought>Checked.</thought><content>${
          JSON.stringify({
            title: "Prepared plan",
            description: "A bounded plan fixture.",
            steps: [{ step: 1, title: "Review", description: "Review the result", successCriteria: ["Reviewed"] }],
          })
        }</content>`,
      }),
      stderr: "",
    };
  };
  const deps = {
    config,
    db: env.db,
    logger,
    skillsService: skills,
    permissions: new PortalPermissionsService(config.portals),
    cliDelegateRun: run,
  };
  const adapter = new AgentComposerAdapter(
    { run: () => Promise.reject(new Error("Unexpected fallback runner")) },
    join(env.tempDir, "Blueprints", "Agents"),
    deps,
  );
  return {
    env,
    config,
    skills,
    adapter,
    launches,
    rows,
    request: (skills: string[]): IFlowStepRequest => ({
      userPrompt: "Prepare the requested artifact without implementing it.",
      context: {},
      portal: "project",
      traceId: crypto.randomUUID(),
      requestId: "request-delivery",
      flowId: "feature-development",
      flowStepId: "design-architecture",
      skills,
    }),
    execute: (role: string, request: IFlowStepRequest) =>
      adapter.runWithStrategy(role, request, ExecutionStrategyName.CLI_DELEGATE),
    cleanup: () => env.cleanup(),
  };
}
