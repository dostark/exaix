// deno-lint-ignore-file no-explicit-any
/**
 * @module TUIAllHelpers
 * @path tests/tui/helpers.ts
 * @description The primary helper repository for TUI tests, providing unified mock data factories,
 * session simulators, and assertion utilities for all terminal views.
 */

import {
  LegacyRequestManagerTuiSession as _LegacyRequestManagerTuiSession,
  RequestManagerView,
} from "../../src/tui/request_manager_view.ts";
import type {
  IRequestAnalysis,
  IRequestEntry as IRequest,
  IRequestMetadata as _IRequestMetadata,
  IRequestOptions,
  IRequestShowResult,
} from "@exaix/core/types/mod.ts";
import type { AnalysisMode } from "@exaix/core/types/mod.ts";
import type { IJournalService, IMemoryService, IPortalService, IRequestService } from "@exaix/core/types";
import { PortalManagerView } from "../../src/tui/portal_manager_view.ts";
import { type ILogEntry, MonitorView } from "../../src/tui/monitor_view.ts";
import { type IPlan, MinimalPlanServiceMock, PlanReviewerTuiSession } from "../../src/tui/plan_reviewer_view.ts";
import { commonTestData, requestFactory } from "../helpers/test_utils.ts";
import { DEFAULT_GLOBAL_MEMORY_VERSION, RequestStatus, type RequestStatusType } from "@exaix/core";
import type {
  IPortalDetails,
  IPortalInfo,
  IVerificationResult as _IVerificationResult,
} from "@exaix/core/types/portal.ts";
import type { ActivityRecord as _ActivityRecord, IDatabaseService, SqliteParam } from "../../src/services/core/db.ts";
import type { IActivityRecord, IJournalFilterOptions } from "@exaix/core/types/database.ts";
import {
  type ISkillSummary,
  MinimalSkillsServiceMock,
  type SkillsManagerTuiSession,
  SkillsManagerView,
} from "../../src/tui/skills_manager_view.ts";
import type {
  IExecutionMemory,
  IGlobalMemory,
  IMemorySearchResult,
  IMemoryUpdateProposal,
  IProjectMemory,
  IProposalLearning,
} from "@exaix/schemas/memory_bank.ts";
import type { JSONObject } from "@exaix/core/types/json.ts";
import {
  ConfidenceAssessmentLevel,
  EvaluationCategory,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryReferenceType,
  MemoryScope,
  PortalStatus,
  RequestPriority,
  RequestSource,
  SkillStatus,
} from "@exaix/core";
import { MemoryViewTuiSession } from "../../src/tui/memory_view.ts";
import type { ITreeNode } from "../../src/tui/helpers/tree_view.ts";
import type { PortalAnalysisMode } from "@exaix/core";

export interface IPortalInfoOverrides {
  alias?: string;
  status?: PortalStatus;
  targetPath?: string;
  symlinkPath?: string;
  contextCardPath?: string;
  [key: string]: any;
}

export interface ILogEntryPayload {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ILogEntryOverrides {
  id?: string;
  trace_id?: string;
  actor?: string;
  identity_id?: string;
  action_type?: string;
  target?: string;
  payload?: ILogEntryPayload | string;
  timestamp?: string;
  [key: string]: string | number | boolean | null | undefined | ILogEntryPayload | unknown;
}

interface IIndexedActivityRecord extends IActivityRecord {
  [key: string]: string | number | null | undefined;
}

// Counter for deterministic IDs in tests
let requestIdCounter = 1;

// Use shared test data factories with deterministic IDs
export const sampleRequest = (overrides: Partial<IRequest> = {}): IRequest => {
  const deterministicOverrides = {
    trace_id: `req-${requestIdCounter++}`,
    ...overrides,
  } as Partial<IRequest>;
  return requestFactory.create(deterministicOverrides) as IRequest;
};

export const sampleRequests = (arr: Array<Partial<IRequest>>): IRequest[] => arr.map((a) => sampleRequest(a));
export const sampleTestRequests = (): IRequest[] => commonTestData.requests.basic() as IRequest[];
export const sampleBasicRequest = (): IRequest[] => commonTestData.requests.basic() as IRequest[];
export const sampleTwoRequests = (): IRequest[] => commonTestData.requests.two() as IRequest[];
export const sampleGroupedRequests = (): IRequest[] => commonTestData.requests.grouped() as IRequest[];
export const sampleNewRequest = (): IRequest[] => [sampleRequest({ trace_id: "new-req", subject: "New Request" })];

// Legacy aliases for backward compatibility
export const sampleIRequest = sampleRequest;
export const sampleBasicIRequest = sampleBasicRequest;
export const sampleNewIRequest = sampleNewRequest;

// Plan helpers using shared utilities
export const sampleBasicPlans = (): IPlan[] => commonTestData.plans.basic();
export const sampleSinglePlan = (): IPlan[] => commonTestData.plans.single();
export const samplePlansWithStatuses = (): IPlan[] => commonTestData.plans.withStatuses();
export const samplePendingPlans = (): IPlan[] => commonTestData.plans.pending();

// Skill helpers using shared utilities
export const sampleBasicSkills = (): ISkillSummary[] => commonTestData.skills.basic() as ISkillSummary[];
export const sampleSingleSkill = (): ISkillSummary => commonTestData.skills.single()[0] as ISkillSummary;
export const sampleSkillsWithStatuses = (): ISkillSummary[] => commonTestData.skills.withStatuses() as ISkillSummary[];

export function createMockRequestService(initial: IRequest[] = []): IRequestService & { requests: IRequest[] } {
  class MockRequestService implements IRequestService {
    requests: IRequest[];
    constructor(requests: IRequest[] = []) {
      this.requests = requests;
    }
    list(status?: RequestStatusType, _includeArchived?: boolean): Promise<IRequest[]> {
      let result = this.requests;
      if (status) {
        result = result.filter((r) => r.status === status);
      }
      return Promise.resolve(result);
    }
    listRequests(status?: RequestStatusType, includeArchived?: boolean): Promise<IRequest[]> {
      return this.list(status, includeArchived);
    }
    show(idOrFilename: string): Promise<IRequestShowResult> {
      const request = this.requests.find((r) => r.trace_id === idOrFilename || r.filename === idOrFilename);
      if (!request) throw new Error("Request not found");
      return Promise.resolve({
        metadata: request,
        content: `Content for ${idOrFilename}`,
      });
    }
    getRequestContent(id: string): Promise<string> {
      const request = this.requests.find((r) => r.trace_id === id);
      return Promise.resolve(request ? `Content for ${id}` : "");
    }
    create(description: string, options?: IRequestOptions) {
      const newRequest: IRequest = {
        trace_id: `test-${Date.now()}`,
        filename: `request-test.md`,
        subject: description,
        status: RequestStatus.PENDING,
        priority: options?.priority || RequestPriority.NORMAL,
        identity: options?.identity || "default",
        portal: options?.portal,
        model: options?.model,
        created: new Date().toISOString(),
        created_by: "test@example.com",
        source: RequestSource.CLI,
      };
      this.requests.push(newRequest);
      return Promise.resolve(newRequest);
    }
    createRequest(description: string, options?: IRequestOptions) {
      return this.create(description, options);
    }
    updateRequestStatus(id: string, status: RequestStatusType) {
      const request = this.requests.find((r) => r.trace_id === id);
      if (request) {
        request.status = status;
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }
    getAnalysis(_id: string): Promise<IRequestAnalysis | null> {
      return Promise.resolve(null);
    }
    analyze(_id: string, _options?: { mode?: AnalysisMode; force?: boolean }): Promise<IRequestAnalysis> {
      return Promise.reject(new Error("Not implemented in mock"));
    }
  }

  return new MockRequestService(initial);
}

export function createViewWithRequests(arr: Array<Partial<IRequest>> = []): {
  service: IRequestService & { requests: IRequest[] };
  view: RequestManagerView;
} {
  const service = createMockRequestService(sampleRequests(arr));
  const view = new RequestManagerView(service);
  return { service, view };
}

export function createTuiWithRequests(arr: Array<Partial<IRequest>> = []): {
  service: IRequestService & { requests: IRequest[] };
  view: RequestManagerView;
  tui: ReturnType<RequestManagerView["createTuiSession"]>;
} {
  const { service, view } = createViewWithRequests(arr);
  const requests = sampleRequests(arr);
  const tui = view.createTuiSession(requests);
  return { service, view, tui };
}

// -------------------------
// Log entry helpers (for MonitorView tests)
// -------------------------
let logIdCounter = 1;

export function sampleLogEntry(overrides: ILogEntryOverrides = {}): ILogEntry {
  const id = overrides.id ?? String(logIdCounter++);
  const payloadValue = overrides.payload ?? {};
  let payloadObj: JSONObject;
  if (typeof payloadValue === "string") {
    try {
      const parsed = JSON.parse(payloadValue);
      payloadObj = typeof parsed === "object" && parsed !== null ? parsed as JSONObject : {};
    } catch {
      payloadObj = {};
    }
  } else {
    payloadObj = payloadValue as JSONObject;
  }
  const { payload: _payload, ...rest } = overrides;
  return {
    id,
    trace_id: overrides.trace_id ?? `trace-${id}`,
    actor: overrides.actor ?? MemoryBankSource.IDENTITY,
    identity_id: overrides.identity_id ?? "default",
    action_type: overrides.action_type ?? "request_created",
    target: overrides.target ?? "Workspace/Requests/test.md",
    payload: payloadObj,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    ...rest,
  } as ILogEntry;
}

export function sampleLogEntries(arr: ILogEntryOverrides[]): ILogEntry[] {
  return arr.map((a) => sampleLogEntry(a));
}

/** Convenience: create two logs with different agents for filter tests */
export function createTwoAgentLogs(): ILogEntry[] {
  return sampleLogEntries([
    { identity_id: "researcher", action_type: "request_created" },
    { identity_id: "architect", action_type: "plan_approved", target: "Workspace/Plans/test.md" },
  ]);
}

/** Convenience: create two logs with different action types for filter tests */
export function createTwoActionLogs(): ILogEntry[] {
  return sampleLogEntries([
    { action_type: "request_created" },
    { action_type: "plan_approved" },
  ]);
}

/** Convenience: create basic monitor test logs */
export function sampleMonitorLogs(): ILogEntry[] {
  return sampleLogEntries([
    {
      id: "1",
      trace_id: "t1",
      actor: MemoryBankSource.USER,
      identity_id: "a1",
      action_type: "request_created",
      target: "target.md",
      payload: {},
      timestamp: "2025-12-22T10:00:00Z",
    },
    {
      id: "2",
      trace_id: "t2",
      actor: MemoryBankSource.USER,
      identity_id: "a2",
      action_type: "plan.approved",
      target: "target2.md",
      payload: {},
      timestamp: "2025-12-22T10:01:00Z",
    },
  ]);
}

/** Convenience: create single monitor test log */
export function sampleSingleMonitorLog(): ILogEntry[] {
  return sampleLogEntries([
    {
      id: "1",
      trace_id: "t1",
      actor: MemoryBankSource.USER,
      identity_id: "a1",
      action_type: "request_created",
      target: "target.md",
      payload: { data: "test" },
      timestamp: "2025-12-22T10:00:00Z",
    },
  ]);
}

// -------------------------
// Portal helpers
// -------------------------
export function samplePortal(overrides: IPortalInfoOverrides = {}): IPortalInfo {
  return {
    alias: overrides.alias ?? `Portal-${Math.floor(Math.random() * 1e6)}`,
    status: overrides.status ?? PortalStatus.ACTIVE,
    targetPath: overrides.targetPath ?? "/Portals/Main",
    symlinkPath: overrides.symlinkPath ?? "",
    contextCardPath: overrides.contextCardPath ?? "",
    ...overrides,
  } as IPortalInfo;
}

export function samplePortals(arr: IPortalInfoOverrides[]): IPortalInfo[] {
  return arr.map((a) => samplePortal(a));
}

export function createMockPortalService(initial: IPortalInfo[] = []): IPortalService & {
  portals: IPortalInfo[];
  actions: Array<{ type: string; id: string }>;
} {
  class MockPortalService implements IPortalService {
    portals: IPortalInfo[];
    actions: { type: string; id: string }[];
    constructor(portals: IPortalInfo[] = []) {
      this.portals = portals;
      this.actions = [];
    }
    list(): Promise<IPortalInfo[]> {
      return this.listPortals();
    }
    listPortals(): Promise<IPortalInfo[]> {
      return Promise.resolve(this.portals);
    }
    openPortal(id: string) {
      if (!this.portals.find((p) => p.alias === id)) return Promise.resolve(false);
      this.actions.push({ type: "open", id });
      return Promise.resolve(true);
    }
    closePortal(id: string) {
      if (!this.portals.find((p) => p.alias === id)) return Promise.resolve(false);
      this.actions.push({ type: "close", id });
      return Promise.resolve(true);
    }
    refreshPortal(id: string) {
      if (!this.portals.find((p) => p.alias === id)) return Promise.resolve(false);
      this.actions.push({ type: "refresh", id });
      return Promise.resolve(true);
    }
    refresh(id: string) {
      this.refreshPortal(id);
      return Promise.resolve();
    }
    removePortal(id: string) {
      if (!this.portals.find((p) => p.alias === id)) return Promise.resolve(false);
      this.actions.push({ type: "remove", id });
      return Promise.resolve(true);
    }
    remove(id: string) {
      this.removePortal(id);
      return Promise.resolve();
    }
    add(path: string, alias: string) {
      this.portals.push({ alias, targetPath: path, status: PortalStatus.ACTIVE, symlinkPath: "", contextCardPath: "" });
      return Promise.resolve();
    }
    show(alias: string): Promise<IPortalDetails> {
      return this.getPortalDetails(alias);
    }
    verify() {
      return Promise.resolve([]);
    }
    getPortalDetails(alias: string) {
      const found = this.portals.find((p) => p.alias === alias);
      if (found) {
        return Promise.resolve({ ...found, permissions: "Read/Write" } as IPortalDetails);
      }
      return Promise.resolve({
        alias,
        targetPath: "",
        symlinkPath: "",
        contextCardPath: "",
        status: PortalStatus.BROKEN,
        permissions: "Read Only",
      } as IPortalDetails);
    }
    quickJumpToPortalDir(alias: string) {
      return Promise.resolve(this.portals.find((p) => p.alias === alias)?.targetPath ?? "");
    }
    getPortalFilesystemPath(alias: string) {
      return Promise.resolve(this.portals.find((p) => p.alias === alias)?.targetPath ?? "");
    }
    getPortalActivityLog(_id: string) {
      return [
        `2025-12-22T12:00:00Z: Portal ${_id} started`,
        `2025-12-22T12:05:00Z: No errors reported`,
      ];
    }
    getKnowledge(_alias: string) {
      return Promise.resolve(null);
    }
    analyze(_alias: string, _options?: { mode?: PortalAnalysisMode; force?: boolean }): Promise<string> {
      return Promise.resolve("Mock analysis result");
    }
  }

  return new MockPortalService(initial);
}

export function createPortalViewWithPortals(arr: IPortalInfoOverrides[] = []): {
  service: IPortalService & { portals: IPortalInfo[]; actions: Array<{ type: string; id: string }> };
  view: PortalManagerView;
} {
  const service = createMockPortalService(samplePortals(arr));
  const view = new PortalManagerView(service);
  return { service, view };
}

export function createPortalTuiWithPortals(arr: IPortalInfoOverrides[] = []): {
  service: IPortalService & { portals: IPortalInfo[]; actions: Array<{ type: string; id: string }> };
  view: PortalManagerView;
  tui: ReturnType<PortalManagerView["createTuiSession"]>;
} {
  const { service, view } = createPortalViewWithPortals(arr);
  // Pass the service's array reference so tests that mutate the service.portals array are reflected in the TUI session
  const tui = view.createTuiSession(service.portals as IPortalInfo[]);
  return { service, view, tui };
}

// -------------------------
// Monitor helpers
// -------------------------
class MockDatabaseService implements IDatabaseService, IJournalService {
  constructor(private readonly _activityRecords: IActivityRecord[] = []) {}
  logActivity() {}
  waitForFlush() {
    return Promise.resolve();
  }
  private fromActivityRecord(record: IActivityRecord): ILogEntry {
    try {
      return {
        ...record,
        payload: JSON.parse(record.payload),
      };
    } catch {
      return {
        ...record,
        payload: { error: "Parse error", raw: record.payload },
      };
    }
  }
  queryActivity(filter: IJournalFilterOptions): Promise<IActivityRecord[]> {
    return this.query(filter);
  }
  query(filter: IJournalFilterOptions): Promise<IActivityRecord[]> {
    let filtered = this._activityRecords;
    if (filter.identityId) {
      filtered = filtered.filter((l) => l.identity_id === filter.identityId);
    }
    if (filter.actionType) {
      filtered = filtered.filter((l) => l.action_type === filter.actionType);
    }
    if (filter.traceId) {
      filtered = filtered.filter((l) => l.trace_id === filter.traceId);
    }
    const since = filter.since as string | undefined;
    if (since) {
      filtered = filtered.filter((l) => l.timestamp > since);
    }
    return Promise.resolve(filtered);
  }
  getDistinctValues(column: string): Promise<string[]> {
    const values = new Set<string>();
    for (const a of this._activityRecords) {
      const val = (a as IIndexedActivityRecord)[column];
      if (val) values.add(String(val));
    }
    return Promise.resolve([...values]);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  preparedGet<T>(_query: string, _params?: SqliteParam[]) {
    return Promise.resolve({} as T);
  }
  preparedAll<T>(_query: string, _params?: SqliteParam[]) {
    return Promise.resolve([] as T[]);
  }
  preparedRun(_query: string, _params?: SqliteParam[]) {
    return Promise.resolve({});
  }
  getActivitiesByTrace(traceId: string): IActivityRecord[] {
    return this._activityRecords.filter((r) => r.trace_id === traceId);
  }
  getActivitiesByTraceSafe(traceId: string) {
    return Promise.resolve(this.getActivitiesByTrace(traceId));
  }
  getActivitiesByActionType(actionType: string): IActivityRecord[] {
    return this._activityRecords.filter((r) => r.action_type === actionType);
  }
  getActivitiesByActionTypeSafe(actionType: string) {
    return Promise.resolve(this.getActivitiesByActionType(actionType));
  }
  getRecentActivity(limit: number = 100): Promise<IActivityRecord[]> {
    return Promise.resolve(this._activityRecords.slice(-limit).reverse());
  }
  insertToolConfirmationRequest(): Promise<void> {
    return Promise.resolve();
  }
  writeToolConfirmationDecision(): Promise<void> {
    return Promise.resolve();
  }
  getToolConfirmationDecision() {
    return Promise.resolve(null);
  }
  listPendingToolConfirmations() {
    return Promise.resolve([]);
  }
  // Test-only method used in some tests
  addLog(log: IActivityRecord) {
    this._activityRecords.push(log);
    return Promise.resolve();
  }
}

export function createMockDatabaseService(activityRecords: IActivityRecord[] = []): IDatabaseService & IJournalService {
  return new MockDatabaseService(activityRecords);
}

function createMockRequestMetadata(overrides: Partial<IRequest> = {}): IRequest {
  return {
    trace_id: overrides.trace_id ?? "req-test",
    filename: overrides.filename ?? "request-test.md",
    path: overrides.path ?? "request-test.md",
    status: overrides.status ?? RequestStatus.PENDING,
    priority: overrides.priority ?? RequestPriority.NORMAL,
    identity: overrides.identity ?? "default",
    created: overrides.created ?? new Date().toISOString(),
    created_by: overrides.created_by ?? "test-user",
    source: overrides.source ?? RequestSource.CLI,
    subject: overrides.subject ?? "Test request",
  };
}

function createMockRequestShowResult(overrides?: Partial<IRequestShowResult>): IRequestShowResult {
  return {
    metadata: overrides?.metadata ?? createMockRequestMetadata(),
    content: overrides?.content ?? "",
  };
}

export function createMonitorViewWithLogs(arr: Array<ILogEntry | ILogEntryOverrides> = []): {
  db: IDatabaseService & IJournalService;
  monitorView: MonitorView;
} {
  const activityRecords: IActivityRecord[] = arr.map((a) => ({
    id: String(a.id ?? crypto.randomUUID()),
    trace_id: String(a.trace_id ?? `trace-${a.id ?? Math.floor(Math.random() * 1e6)}`),
    actor: (a.actor as string | null) ?? null,
    actor_type: null,
    identity_id: (a.identity_id as string | null) ?? null,
    agent_kind: null,
    action_type: String(a.action_type ?? "unknown"),
    target: (a.target as string | null) ?? null,
    payload: typeof a.payload === "string" ? a.payload : JSON.stringify(a.payload ?? {}),
    timestamp: String(a.timestamp ?? new Date().toISOString()),
    count: (a && typeof a === "object" && "count" in a && typeof a.count === "number") ? a.count : undefined,
  }));

  const db = createMockDatabaseService(activityRecords);
  const monitorView = new MonitorView(db);
  Reflect.set(
    monitorView,
    "logs",
    activityRecords.map((log) => ({
      id: log.id,
      trace_id: log.trace_id,
      actor: log.actor,
      identity_id: log.identity_id,
      action_type: log.action_type,
      target: log.target,
      payload: JSON.parse(log.payload),
      timestamp: log.timestamp,
      count: log.count,
    })),
  );
  return { db, monitorView };
}

export function createMonitorTuiSession(arr: Array<ILogEntry | ILogEntryOverrides> = []): {
  db: IDatabaseService & IJournalService;
  monitorView: MonitorView;
  session: ReturnType<MonitorView["createTuiSession"]>;
} {
  const converted: ILogEntryOverrides[] = arr.map((a) => {
    // If the caller passed a ILogEntry, convert it to a plain record with stringified payload
    if ("action_type" in a && typeof a.action_type === "string") {
      const log = a as ILogEntry;
      return {
        id: log.id,
        trace_id: log.trace_id,
        actor: log.actor ?? undefined,
        identity_id: log.identity_id ?? undefined,
        action_type: log.action_type,
        target: log.target ?? undefined,
        payload: typeof log.payload === "string" ? log.payload : JSON.stringify(log.payload),
        timestamp: log.timestamp,
      };
    }
    return a as ILogEntryOverrides;
  });

  const { db, monitorView } = createMonitorViewWithLogs(converted);
  const session = monitorView.createTuiSession(false);
  return { db, monitorView, session };
}

export const createMonitorViewSession = createMonitorTuiSession;

// -------------------------
// Plan reviewer helpers
// -------------------------
export function createPlanReviewerSession(plans: IPlan[] = []): {
  mock: MinimalPlanServiceMock;
  session: PlanReviewerTuiSession;
} {
  const mock = new MinimalPlanServiceMock();
  const session = new PlanReviewerTuiSession(plans, mock);
  return { mock, session };
}

// -------------------------
// Tree view helpers
// -------------------------
export function createTestTree(): ITreeNode[] {
  return [
    {
      id: "root1",
      label: "Root 1",
      type: "root",
      expanded: true,
      children: [
        {
          id: "child1-1",
          label: "Child 1.1",
          type: "item",
          expanded: false,
          children: [],
        },
        {
          id: "child1-2",
          label: "Child 1.2",
          type: "item",
          expanded: true,
          children: [
            {
              id: "grandchild1-2-1",
              label: "Grandchild 1.2.1",
              type: "leaf",
              expanded: false,
              children: [],
            },
          ],
        },
      ],
    },
    {
      id: "root2",
      label: "Root 2",
      type: "root",
      expanded: false,
      children: [
        {
          id: "child2-1",
          label: "Child 2.1",
          type: "item",
          expanded: false,
          children: [],
        },
      ],
    },
  ];
}

export function createLargeTestTree(depth: number = 3, breadth: number = 5): ITreeNode[] {
  function createLevel(currentDepth: number, prefix: string): ITreeNode[] {
    if (currentDepth >= depth) return [];

    const nodes: ITreeNode[] = [];
    for (let i = 0; i < breadth; i++) {
      const id = `${prefix}${i}`;
      nodes.push({
        id,
        label: `Node ${id}`,
        type: currentDepth === 0 ? "root" : "item",
        expanded: currentDepth === 0,
        children: createLevel(currentDepth + 1, `${id}-`),
      });
    }
    return nodes;
  }

  return createLevel(0, "node-");
}

// -------------------------
// Key simulation helpers
// -------------------------
export async function simulateKeySequence(
  handler: (key: string) => void | Promise<void>,
  keys: string[],
  delayMs: number = 0,
): Promise<void> {
  for (const key of keys) {
    await handler(key);
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export function typeString(text: string): string[] {
  return text.split("");
}

// -------------------------
// Render assertion helpers
// -------------------------
export function getVisibleText(lines: string[]): string[] {
  // Strip ANSI codes for easier assertions
  // deno-lint-ignore no-control-regex
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  return lines.map((line) => line.replace(ansiRegex, ""));
}

export function findLineContaining(lines: string[], text: string): number {
  const visibleLines = getVisibleText(lines);
  return visibleLines.findIndex((line) => line.includes(text));
}

export function hasLineContaining(lines: string[], text: string): boolean {
  return findLineContaining(lines, text) !== -1;
}

export function countLinesContaining(lines: string[], text: string): number {
  const visibleLines = getVisibleText(lines);
  return visibleLines.filter((line) => line.includes(text)).length;
}

// -------------------------
// Legacy request manager helpers
// -------------------------
export function createLegacyMockRequestService(): IRequestService {
  return {
    list: () => Promise.resolve([]),
    listRequests: () => Promise.resolve([]),
    show: (_id: string) => Promise.resolve(createMockRequestShowResult()),
    getRequestContent: () => Promise.resolve(""),
    create: () => Promise.resolve(createMockRequestMetadata()),
    createRequest: () => Promise.resolve(createMockRequestMetadata()),
    updateRequestStatus: () => Promise.resolve(true),
    getAnalysis: () => Promise.resolve(null),
    analyze: () => Promise.reject(new Error("Not implemented in legacy mock")),
  };
}

export function createLegacyTuiSession(
  requests: IRequest[] = [],
): InstanceType<typeof _LegacyRequestManagerTuiSession> {
  const mockService = createLegacyMockRequestService();
  return new _LegacyRequestManagerTuiSession(requests, mockService as IRequestService);
}

export function createLegacyTuiSessionWithTracking(): {
  session: InstanceType<typeof _LegacyRequestManagerTuiSession>;
  createCalled: () => boolean;
  viewCalled: () => boolean;
  deleteCalled: () => boolean;
} {
  let createCalled = false;
  let viewCalled = false;
  let deleteCalled = false;

  const mockService = {
    list: () => Promise.resolve([]),
    listRequests: () => Promise.resolve([]),
    show: () => Promise.resolve(createMockRequestShowResult()),
    getRequestContent: (_id: string) => {
      viewCalled = true;
      return Promise.resolve("content");
    },
    create: () => {
      createCalled = true;
      return Promise.resolve(commonTestData.mockObjects.newRequest() as IRequest);
    },
    createRequest: () => {
      createCalled = true;
      return Promise.resolve(commonTestData.mockObjects.newRequest() as IRequest);
    },
    updateRequestStatus: () => {
      deleteCalled = true;
      return Promise.resolve(true);
    },
    getAnalysis: () => Promise.resolve(null),
    analyze: () => Promise.reject(new Error("Not implemented in legacy mock")),
  };

  const requests = sampleTestRequests();
  const session = new _LegacyRequestManagerTuiSession(requests, mockService as IRequestService);

  return { session, createCalled: () => createCalled, viewCalled: () => viewCalled, deleteCalled: () => deleteCalled };
}

export function createLegacyTuiSessionWithLongTraceId(): InstanceType<typeof _LegacyRequestManagerTuiSession> {
  const mockService = {
    listRequests: () => Promise.resolve([]),
    list: () => Promise.resolve([]),
    show: () => Promise.resolve(createMockRequestShowResult()),
    getRequestContent: () => Promise.resolve(""),
    create: () =>
      Promise.resolve({
        trace_id: "12345678-abcd-efgh-ijkl-mnopqrstuvwx",
      } as Partial<IRequest> as IRequest),
    createRequest: () =>
      Promise.resolve({
        trace_id: "12345678-abcd-efgh-ijkl-mnopqrstuvwx",
      } as Partial<IRequest> as IRequest),
    updateRequestStatus: () => Promise.resolve(true),
    getAnalysis: () => Promise.resolve(null),
    analyze: () => Promise.reject(new Error("Not implemented in legacy mock")),
  };

  const requests = sampleTestRequests();
  return new _LegacyRequestManagerTuiSession(requests, mockService as IRequestService);
}

export function createLegacyTuiSessionWithErrors(): InstanceType<typeof _LegacyRequestManagerTuiSession> {
  const mockService = {
    listRequests: () => Promise.resolve([]),
    list: () => Promise.reject(new Error("List error")),
    show: () => Promise.reject(new Error("Show error")),
    getRequestContent: () => Promise.reject(new Error("View error")),
    create: () => Promise.reject(new Error("Create error")),
    createRequest: () => Promise.reject(new Error("Create error")),
    updateRequestStatus: () => Promise.reject(new Error("Delete error")),
    getAnalysis: () => Promise.reject(new Error("Analysis error")),
    analyze: () => Promise.reject(new Error("Analysis error")),
  };

  const requests = sampleTestRequests();
  return new _LegacyRequestManagerTuiSession(requests, mockService as IRequestService);
}

// -------------------------
// Dialog test helpers
// -------------------------
export function createMockDialogRenderOptions(width: number = 60, height: number = 20): {
  useColors: boolean;
  width: number;
  height: number;
} {
  return {
    useColors: false,
    width,
    height,
  };
}

// -------------------------
// Skills Manager helpers
// -------------------------

export enum SkillSource {
  CORE = "core",
  PROJECT = "project",
}

export interface ISkillSummaryOverrides {
  id?: string;
  skill_id?: string;
  name?: string;
  version?: string;
  status?: SkillStatus;
  source?: MemoryBankSource | SkillSource;
  description?: string;
  triggers?: { keywords?: string[]; taskTypes?: string[]; filePatterns?: string[]; [key: string]: any };
  instructions?: string;
  usage_count?: number;
  created_at?: string;
  scope?: MemoryScope;
  [key: string]: any;
}

export function sampleSkill(overrides: ISkillSummaryOverrides = {}): ISkillSummary {
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    source: MemoryBankSource.CORE,
    scope: MemoryScope.GLOBAL,
    status: SkillStatus.ACTIVE,
    skill_id: `skill-${Math.floor(Math.random() * 1e6)}`,
    name: "Test Skill",
    version: DEFAULT_GLOBAL_MEMORY_VERSION,
    description: "Test skill description",
    triggers: {
      keywords: ["test"],
    },
    instructions: "Test instructions",
    usage_count: 0,
    ...overrides,
  } as ISkillSummary;
}

export function sampleSkills(arr: ISkillSummaryOverrides[]): ISkillSummary[] {
  return arr.map((a) => sampleSkill(a));
}

export function sampleTestSkills(): ISkillSummary[] {
  return sampleSkills([
    {
      id: "tdd-methodology",
      name: "TDD Methodology",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.CORE,
      description: "Test-Driven Development methodology",
      triggers: {
        keywords: ["tdd", "test-first"],
        taskTypes: ["testing"],
        filePatterns: ["*_test.ts"],
      },
      instructions: "Write failing test first, then implement.\nRepeat until done.\nRefactor as needed.",
    },
    {
      id: "security-first",
      name: "Security First",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.CORE,
      description: "Security-focused development",
      triggers: {
        keywords: [EvaluationCategory.SECURITY, "auth"],
      },
    },
    {
      id: "project-conventions",
      name: "Project Conventions",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.PROJECT,
    },
    {
      id: "learned-pattern",
      name: "Learned Pattern",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      status: SkillStatus.DRAFT,
      source: MemoryBankSource.LEARNED,
    },
    {
      id: "deprecated-skill",
      name: "Deprecated Skill",
      version: "0.5.0",
      status: SkillStatus.DEPRECATED,
      source: MemoryBankSource.PROJECT,
    },
  ]);
}

export function createTestSkills(): ISkillSummary[] {
  return sampleTestSkills();
}

// MinimalSkillsServiceMock is now imported from src/tui/skills_manager_view.ts

export function createMockSkillsService(initial: ISkillSummaryOverrides[] = []): MinimalSkillsServiceMock {
  return new MinimalSkillsServiceMock(sampleSkills(initial));
}

export function createSkillsManagerViewWithMock(skills: ISkillSummary[] = sampleTestSkills()): {
  service: MinimalSkillsServiceMock;
  view: SkillsManagerView;
} {
  const service = new MinimalSkillsServiceMock(skills);
  const view = new SkillsManagerView(service);
  return { service, view };
}

export function createSkillsManagerTuiSession(skills: ISkillSummary[] = sampleTestSkills()): {
  service: MinimalSkillsServiceMock;
  view: SkillsManagerView;
  session: ReturnType<SkillsManagerView["createTuiSession"]>;
} {
  const { service, view } = createSkillsManagerViewWithMock(skills);
  const session = view.createTuiSession(false);
  return { service, view, session };
}

export function testSkillsSessionRender(
  name: string,
  keySequence: string[],
  assertion: (rendered: string, session: SkillsManagerTuiSession) => void | Promise<void>,
  options: {
    skills?: ISkillSummary[];
    useColors?: boolean;
  } = {},
): void {
  Deno.test(name, async () => {
    const { session } = createSkillsManagerTuiSession(options.skills);
    await session.initialize();

    for (const key of keySequence) {
      await session.handleKey(key);
    }

    const rendered = session.render();
    await assertion(rendered, session);
  });
}

// Memory View mock data
export function createMockProposals(): IMemoryUpdateProposal[] {
  return [
    {
      id: "proposal-1",
      created_at: new Date().toISOString(),
      identity_id: "test-identity",
      operation: MemoryOperation.ADD,
      learning: {
        id: "729b8001-0000-4000-8000-000000000001",
        created_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        source: MemoryBankSource.IDENTITY,
        scope: MemoryScope.PROJECT,
        title: "Error Handling Pattern",
        description: "Use try-catch for all async functions",
        category: LearningCategory.PATTERN,
        tags: ["error-handling"],
        confidence: ConfidenceAssessmentLevel.HIGH,
        references: [{ type: MemoryReferenceType.FILE, path: "src/db.ts" }],
      } as IProposalLearning,
      target_scope: MemoryScope.PROJECT,
      target_project: "my-app",
      reason: "Extracted from execution",
      status: "pending",
    } as IMemoryUpdateProposal,
    {
      id: "proposal-2",
      created_at: new Date().toISOString(),
      identity_id: "test-identity",
      operation: MemoryOperation.ADD,
      learning: {
        id: "729b8001-0000-4000-8000-000000000002",
        created_at: new Date(Date.now() - 18000000).toISOString(), // 5 hours ago
        source: MemoryBankSource.IDENTITY,
        scope: MemoryScope.GLOBAL,
        title: "API Rate Limiting",
        description: "Implement rate limiting for all API endpoints",
        category: LearningCategory.DECISION,
        tags: [MemoryReferenceType.API, EvaluationCategory.SECURITY],
        confidence: ConfidenceAssessmentLevel.MEDIUM,
      } as IProposalLearning,
      target_scope: MemoryScope.GLOBAL,
      reason: "Common pattern across projects",
      status: "pending",
    } as IMemoryUpdateProposal,
    {
      id: "proposal-3",
      created_at: new Date().toISOString(),
      identity_id: "test-identity",
      operation: MemoryOperation.ADD,
      learning: {
        id: "729b8001-0000-4000-8000-000000000003",
        created_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        source: MemoryBankSource.EXECUTION,
        scope: MemoryScope.PROJECT,
        title: "Database Connection Issue",
        description: "Connection timeout solutions",
        category: LearningCategory.TROUBLESHOOTING,
        tags: ["database"],
        confidence: ConfidenceAssessmentLevel.HIGH,
      } as IProposalLearning,
      target_scope: MemoryScope.PROJECT,
      target_project: "api-service",
      reason: "Documented troubleshooting steps",
      status: "pending",
    } as IMemoryUpdateProposal,
  ];
}

export function createMemoryViewSession(proposals: IMemoryUpdateProposal[] = []): {
  service: MinimalMemoryServiceMock;
  session: MemoryViewTuiSession;
} {
  const service = new MinimalMemoryServiceMock(proposals);
  const session = new MemoryViewTuiSession(service);
  return { service, session };
}

export async function createInitializedMemoryViewSession(proposals: IMemoryUpdateProposal[] = []): Promise<{
  service: MinimalMemoryServiceMock;
  session: MemoryViewTuiSession;
}> {
  const { service, session } = createMemoryViewSession(proposals);
  await session.initialize();
  return { service, session };
}

export class MinimalMemoryServiceMock implements IMemoryService {
  proposals: IMemoryUpdateProposal[] = [];
  approvedCount = 0;

  constructor(proposals: IMemoryUpdateProposal[] = []) {
    this.proposals = proposals;
  }

  getProjects(): Promise<string[]> {
    return Promise.resolve(["default"]);
  }

  getProjectMemory(_portal: string): Promise<IProjectMemory | null> {
    return Promise.resolve(null);
  }

  getGlobalMemory(): Promise<IGlobalMemory | null> {
    return Promise.resolve(null);
  }

  getExecutionByTraceId(_traceId: string): Promise<IExecutionMemory | null> {
    return Promise.resolve(null);
  }

  getExecutionHistory(_options?: { portal?: string; limit?: number }): Promise<IExecutionMemory[]> {
    return Promise.resolve([]);
  }

  search(_query: string, _options?: { portal?: string; limit?: number }): Promise<IMemorySearchResult[]> {
    return Promise.resolve([]);
  }

  listPending(): Promise<IMemoryUpdateProposal[]> {
    return Promise.resolve(this.proposals);
  }

  getPending(proposalId: string): Promise<IMemoryUpdateProposal | null> {
    return Promise.resolve(
      this.proposals.find((p) => p.id === proposalId) ?? null,
    );
  }

  approvePending(proposalId: string): Promise<void> {
    this.proposals = this.proposals.filter((p) => p.id !== proposalId);
    this.approvedCount++;
    return Promise.resolve();
  }

  rejectPending(proposalId: string, _reason: string): Promise<void> {
    this.proposals = this.proposals.filter((p) => p.id !== proposalId);
    return Promise.resolve();
  }

  getApprovedCount(): number {
    return this.approvedCount;
  }
}
