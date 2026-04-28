/**
 * @module RequestTestHelpers
 * @path tests/services/request/request_test_helpers.ts
 * @description Common utilities and factory functions for Request migration and processor tests.
 */

import { join } from "@std/path";
import { ANALYZER_VERSION } from "@exaix/core";
import { type IRequestAnalysis, RequestAnalysisComplexity, RequestTaskType } from "@exaix/schemas/request_analysis.ts";
import { AnalysisMode } from "../../../src/shared/types/request.ts";
import { initTestDbService } from "../../helpers/db.ts";
import type {
  IRequestAnalysisContext,
  IRequestAnalyzerService,
} from "../../../src/shared/interfaces/i_request_analyzer_service.ts";
import { RequestSource } from "@exaix/core";
import { RequestStatus } from "@exaix/core";
import type { IPortalKnowledgeService } from "../../../src/shared/interfaces/i_portal_knowledge_service.ts";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";
import { PortalAnalysisMode } from "@exaix/core";

export function makeAnalysis(overrides: Partial<IRequestAnalysis> = {}): IRequestAnalysis {
  return {
    goals: [{ description: "test goal", explicit: true, priority: 1 }],
    requirements: [{ description: "must pass tests", confidence: 0.9, type: "functional", explicit: true }],
    constraints: [],
    acceptanceCriteria: ["all green"],
    ambiguities: [],
    actionabilityScore: 80,
    complexity: RequestAnalysisComplexity.SIMPLE,
    taskType: RequestTaskType.UNKNOWN,
    tags: [],
    referencedFiles: [],
    metadata: {
      analyzedAt: new Date().toISOString(),
      durationMs: 42,
      mode: AnalysisMode.HEURISTIC,
      analyzerVersion: ANALYZER_VERSION,
    },
    ...overrides,
  };
}

export function makeFakeAnalyzer(analysis: IRequestAnalysis): IRequestAnalyzerService {
  return {
    analyze: (_text: string, _ctx?: IRequestAnalysisContext) => Promise.resolve(analysis),
    analyzeQuick: (_text: string) => analysis,
  };
}

export function makeThrowingAnalyzer(): IRequestAnalyzerService {
  return {
    analyze: (_text: string, _ctx?: IRequestAnalysisContext) => Promise.reject(new Error("Analyzer exploded")),
    analyzeQuick: (_text: string): Partial<IRequestAnalysis> => ({
      taskType: undefined,
      tags: undefined,
      referencedFiles: undefined,
    }),
  };
}

export async function makeRequestProcessorEnv(): Promise<{
  db: Awaited<ReturnType<typeof initTestDbService>>["db"];
  config: Awaited<ReturnType<typeof initTestDbService>>["config"];
  tempDir: string;
  cleanup: Awaited<ReturnType<typeof initTestDbService>>["cleanup"];
  workspacePath: string;
  requestsDir: string;
  blueprintsPath: string;
  processorConfig: {
    workspacePath: string;
    requestsDir: string;
    blueprintsPath: string;
    includeReasoning: boolean;
  };
}> {
  const { db, config, tempDir, cleanup } = await initTestDbService();

  const workspacePath = join(tempDir, config.paths.workspace);
  const requestsDir = join(workspacePath, config.paths.requests);
  const plansDir = join(workspacePath, config.paths.plans);
  const blueprintsPath = join(tempDir, config.paths.blueprints);

  const identitiesPath = join(blueprintsPath, config.paths.identities);
  await Deno.mkdir(requestsDir, { recursive: true });
  await Deno.mkdir(plansDir, { recursive: true });
  await Deno.mkdir(identitiesPath, { recursive: true });

  const processorConfig = {
    workspacePath,
    requestsDir,
    blueprintsPath,
    includeReasoning: false,
  };

  return { db, config, tempDir, cleanup, workspacePath, requestsDir, blueprintsPath, processorConfig };
}

export function makeAgentRequestFileSync(requestsDir: string, options: {
  requestId?: string;
  body?: string;
  identity?: string;
  traceId?: string;
  status?: string;
  source?: string;
  portal?: string;
} = {}): string {
  const requestId = options.requestId ?? "req-001";
  const body = options.body ?? "Fix the login bug in the auth module";
  const identity = options.identity ?? "nonexistent-agent";
  const filePath = join(requestsDir, `${requestId}.md`);

  const fields = [
    `trace_id: "${options.traceId ?? `trace-${requestId}`}"`,
    `created: "${new Date().toISOString()}"`,
    `status: "${options.status ?? RequestStatus.PENDING}"`,
    `priority: "normal"`,
    `identity: "${identity}"`,
    `source: "${options.source ?? RequestSource.CLI}"`,
    options.portal ? `portal: "${options.portal}"` : null,
    `created_by: "test-user"`,
  ].filter(Boolean);

  const content = `---
${fields.join("\n")}
---
${body}`;

  Deno.writeTextFileSync(filePath, content);
  return filePath;
}

export function makeFlowRequestFileSync(requestsDir: string, options: {
  requestId?: string;
  body?: string;
  flow?: string;
  traceId?: string;
  status?: string;
} = {}): string {
  const requestId = options.requestId ?? "req-flow-001";
  const body = options.body ?? "Run the deployment flow";
  const flow = options.flow ?? "deploy-flow";
  const filePath = join(requestsDir, `${requestId}.md`);

  const fields = [
    `trace_id: "${options.traceId ?? `trace-${requestId}`}"`,
    `created: "${new Date().toISOString()}"`,
    `status: "${options.status ?? RequestStatus.PENDING}"`,
    `priority: "normal"`,
    `flow: "${flow}"`,
    `source: "${RequestSource.CLI}"`,
    `created_by: "test-user"`,
  ].filter(Boolean);

  const content = `---
${fields.join("\n")}
---
${body}`;

  Deno.writeTextFileSync(filePath, content);
  return filePath;
}

export function makeBlueprintFileSync(blueprintsPath: string, identity: string): string {
  const blueprintPath = join(blueprintsPath, "Identities", `${identity}.md`);
  const content = `# Blueprint for ${identity}
You are a helpful assistant.
`;
  Deno.writeTextFileSync(blueprintPath, content);
  return blueprintPath;
}

export function makeKnowledge(overrides: Partial<IPortalKnowledge> = {}): IPortalKnowledge {
  return {
    portal: "test-portal",
    gatheredAt: new Date().toISOString(),
    version: 1,
    architectureOverview: "## Architecture\n\nThis is a TypeScript service codebase.\nIt has several layers.\n",
    layers: [],
    keyFiles: [
      { path: "src/main.ts", role: "entrypoint", description: "Application entry point" },
      { path: "src/services/auth.ts", role: "core-service", description: "Auth service" },
    ],
    conventions: [
      {
        name: "*.service.ts naming",
        description: "Services use .service.ts suffix",
        evidenceCount: 10,
        confidence: "high",
        examples: ["auth.service.ts"],
        category: "naming",
      },
      {
        name: "IFoo interface naming",
        description: "Interfaces start with I prefix",
        evidenceCount: 5,
        confidence: "medium",
        examples: ["IAuthService"],
        category: "naming",
      },
    ],
    dependencies: [],
    packages: undefined,
    techStack: { primaryLanguage: "typescript" },
    symbolMap: [],
    stats: {
      totalFiles: 20,
      totalDirectories: 5,
      extensionDistribution: { ".ts": 18, ".json": 2 },
    },
    metadata: {
      durationMs: 200,
      mode: PortalAnalysisMode.QUICK,
      filesScanned: 20,
      filesRead: 10,
    },
    ...overrides,
  };
}

export function makeMockKnowledgeService(
  opts: { fail?: boolean; knowledge?: IPortalKnowledge } = {},
): IPortalKnowledgeService & { callCount: number } {
  let callCount = 0;
  const knowledge = opts.knowledge ?? makeKnowledge();
  return {
    get callCount() {
      return callCount;
    },
    analyze: (_alias: string, _path: string) => {
      callCount++;
      if (opts.fail) return Promise.reject(new Error("Analysis failed"));
      return Promise.resolve(knowledge);
    },
    getOrAnalyze: (_alias: string, _path: string) => {
      callCount++;
      if (opts.fail) return Promise.reject(new Error("getOrAnalyze failed"));
      return Promise.resolve(knowledge);
    },
    isStale: (_alias: string) => Promise.resolve(false),
    updateKnowledge: (_alias: string, _path: string) => Promise.resolve(knowledge),
  } as IPortalKnowledgeService & { callCount: number };
}
