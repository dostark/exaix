/**
 * @module SessionDelegationCoordinator
 * @path apps/daemon/src/session_delegation_coordinator.ts
 * @description Phase 174 Step 1 daemon-layer orchestration for one governed,
 *   lineage-linked code-change session delegation.
 * @architectural-layer Application
 * @dependencies [@exaix/core, @exaix/session, @exaix/schemas]
 * @related-files [apps/daemon/main.ts, packages/session/src/session_delegation.ts, apps/daemon/src/session_return_watcher.ts]
 */

import { DomainEventType, type TDomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import { buildDelegateBriefArgs, isContentlessBrief } from "@exaix/core/planning";
import {
  SESSION_DEFAULT_DEADLINE_HOURS,
  SESSION_DEFAULT_MAX_INPUT_TOKENS,
  SESSION_DEFAULT_MAX_OUTPUT_TOKENS,
  SESSION_DEFAULT_MAX_TOTAL_TOKENS,
  TIME_MS_PER_HOUR,
} from "@exaix/core/types";
import { ContextConnectionCloseReason, ProviderType } from "@exaix/core/types";
import type { IDogfoodContextConnection, IDogfoodContextPort, Opt, Reason } from "@exaix/core/types";
import { toMcpConnectionInput } from "@exaix/session/dogfood_mcp_config.ts";
import type { IDogfoodMcpConnectionInput } from "@exaix/session/dogfood_mcp_config.ts";
import { SessionGateSchema, SessionLaunchModeSchema } from "@exaix/schemas/session_delegate.ts";
import type {
  SessionBrief,
  SessionDelegateConfig,
  SessionTokenStats,
  SessionWaitState,
} from "@exaix/schemas/session_delegate.ts";
import type { ISessionLaunch } from "@exaix/session/i_session_adapter.ts";
import type { IHardenedLaunchResult, IPrepareBriefInput } from "@exaix/session/i_session_delegate.ts";
import {
  type ISessionDelegationCoordinator,
  type ISessionDelegationOutcome,
  type ISessionDelegationRequest,
  SessionDelegateLaunchedPayloadSchema,
  SessionDelegationOutcomeSchema,
  SessionDelegationStatusSchema,
} from "@exaix/session/session_delegation.ts";
import type { ISessionDelegationResultStore } from "@exaix/session/session_delegation_result_store.ts";
import type { ISessionWaitStore } from "@exaix/session/wait/i_session_wait_store.ts";
import type { ISessionDelegateEventPayload } from "@exaix/session/event_payload.ts";

export interface ISessionDelegationLauncher {
  launch(
    launch: ISessionLaunch,
    traceId: string,
    delegateProviderEnv: Record<string, string> | undefined,
  ): Promise<void>;
}

export interface ISessionCoordinatorDelegateService {
  prepareBrief(input: IPrepareBriefInput): Promise<SessionBrief>;
  resolveLaunch(brief: SessionBrief, mode: SessionBriefLaunchMode): ISessionLaunch;
  resolveHardenedLaunch(
    brief: SessionBrief,
    mode: SessionBriefLaunchMode,
    config: SessionDelegateConfig,
    connection?: IDogfoodMcpConnectionInput,
  ): Promise<IHardenedLaunchResult>;
  resolveDelegateEnv(
    config: SessionDelegateConfig,
    tool: SessionDelegateConfig["tool"],
    providerApiKey: string,
  ): Record<string, string>;
}

export interface ISessionDelegationCoordinatorDeps {
  config: SessionDelegateConfig;
  delegateService: ISessionCoordinatorDelegateService;
  waitStore: ISessionWaitStore;
  resultStore: ISessionDelegationResultStore;
  launcher: ISessionDelegationLauncher;
  resolveModel(parentTraceId: string): Promise<string | undefined>;
  resolveProviderApiKey(keyEnv: string): string | undefined;
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
  /** Optional dogfood bounded-context port; absent preserves the existing objective
   *  byte-for-byte. A failure surfaces as the existing `launch_failed` terminal outcome. */
  contextPort?: Opt<IDogfoodContextPort, Reason.OptionalDependency>;
}

export interface ICodeChangesDelegateAdapterDeps {
  coordinator: ISessionDelegationCoordinator;
  logger: Pick<IEventLogger, "warn">;
}

export interface IDelegatedPlanStep {
  number: number;
  title: string;
  content: string;
  successCriteria?: string[];
}

type SessionBriefLaunchMode = "headless";

const SESSION_DELEGATION_WAIT_POLL_MS = 2_000;

/** "abandoned"/"rejected"/"launch_failed" all map to FAILED — the connection genuinely
 *  never reached a clean, cancelled, or completed close.  */
function closeReasonForOutcomeStatus(status: ISessionDelegationOutcome["status"]): ContextConnectionCloseReason {
  if (status === "completed") return ContextConnectionCloseReason.COMPLETED;
  if (status === "cancelled" || status === "expired") return ContextConnectionCloseReason.CANCELLED;
  return ContextConnectionCloseReason.FAILED;
}
const LEGACY_PERMITTED_PATHS: string[] = ["Workspace/**"];
const EMPTY_TOKEN_STATS: SessionTokenStats = {
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
};

/** Daemon-owned authority and lifecycle coordinator for a single delegation.
 * @visible
 */
export class SessionDelegationCoordinator implements ISessionDelegationCoordinator {
  /** recordId -> owning delegationTraceId, for a bulk close on parent (daemon) shutdown
   *  while a delegation is still mid-`awaitTerminal`. */
  private readonly openContextRecords = new Map<string, string>();

  constructor(
    private readonly deps: ISessionDelegationCoordinatorDeps,
    private readonly logger: IEventLogger,
  ) {}

  async delegate(input: ISessionDelegationRequest): Promise<ISessionDelegationOutcome> {
    const delegationTraceId = input.delegationTraceId ?? crypto.randomUUID();
    let parked = false;
    let contextRecordId: string | undefined;
    try {
      this.assertEnabled();
      const { brief, recordId, connection } = await this.prepareBrief(input, delegationTraceId);
      contextRecordId = recordId;
      if (contextRecordId) this.openContextRecords.set(contextRecordId, delegationTraceId);
      const wait = await this.deps.waitStore.park(
        delegationTraceId,
        brief.gate,
        brief.resume_token,
        brief.deadline,
      );
      parked = true;
      if (wait.status !== "pending") {
        await this.closeContext(contextRecordId, ContextConnectionCloseReason.FAILED);
        return this.terminalOutcome(input, delegationTraceId, "launch_failed", "delegation wait could not be parked");
      }

      const launch = await this.resolveLaunch(brief, connection);
      const providerEnv = this.resolveProviderEnv(connection);
      await this.emitLaunched(input, brief, delegationTraceId);
      await this.deps.launcher.launch(launch, delegationTraceId, providerEnv);
      await this.log(DomainEventType.SessionDelegateBriefed, delegationTraceId, {
        trace_id: delegationTraceId,
        parent_trace_id: input.parentTraceId,
        parent_step_id: input.parentStepId,
        sequence: input.sequence,
        mode: this.deps.config.launch_mode,
        tool: this.deps.config.tool,
        gate: SessionGateSchema.enum.code_changes,
      });
      const outcome = await this.awaitTerminal(input, brief);
      await this.closeContext(contextRecordId, closeReasonForOutcomeStatus(outcome.status));
      return outcome;
    } catch {
      if (parked) {
        try {
          await this.deps.waitStore.expire(delegationTraceId);
        } catch {
          // The wait may already be terminal; launch failure still maps deterministically.
        }
      }
      await this.closeContext(contextRecordId, ContextConnectionCloseReason.FAILED);
      await this.log(DomainEventType.SessionDelegateBriefFailed, delegationTraceId, {
        trace_id: delegationTraceId,
        parent_trace_id: input.parentTraceId,
        parent_step_id: input.parentStepId,
        sequence: input.sequence,
        gate: SessionGateSchema.enum.code_changes,
        error: "delegation launch failed",
      });
      return this.terminalOutcome(input, delegationTraceId, "launch_failed", "delegation launch failed");
    }
  }

  /** Closes and stops tracking one context connection; a no-op when none was opened.
   *  Errors from the port's own close() never mask the delegation's real outcome. */
  private async closeContext(
    recordId: Opt<string, Reason.OptionalContext>,
    reason: ContextConnectionCloseReason,
  ): Promise<void> {
    if (!recordId || !this.deps.contextPort) return;
    this.openContextRecords.delete(recordId);
    try {
      await this.deps.contextPort.close(recordId, reason);
    } catch (error) {
      await this.logger.warn(
        DomainEventType.SessionDelegateBriefFailed,
        recordId,
        { warning: `dogfood context close failed: ${error instanceof Error ? error.message : String(error)}` },
      );
    }
  }

  /** Registered with the daemon's graceful-shutdown sequence — closes every context
   *  connection still open for a delegation mid-awaitTerminal when the process exits. */
  async closeAllOpenContextConnections(): Promise<void> {
    const recordIds = [...this.openContextRecords.keys()];
    for (const recordId of recordIds) {
      await this.closeContext(recordId, ContextConnectionCloseReason.CANCELLED);
    }
  }

  private assertEnabled(): void {
    const config = this.deps.config;
    if (
      !config.enabled ||
      config.launch_mode !== SessionLaunchModeSchema.enum.headless ||
      !config.gates.includes(SessionGateSchema.enum.code_changes)
    ) {
      throw new Error("session delegation is unavailable");
    }
  }

  private async prepareBrief(
    input: ISessionDelegationRequest,
    delegationTraceId: string,
  ): Promise<{ brief: SessionBrief; recordId?: string; connection?: IDogfoodContextConnection }> {
    const config = this.deps.config;
    const resolvedModel = await this.deps.resolveModel(input.parentTraceId);
    const model = resolvedModel ?? config.model;
    const deadline = new Date(
      this.deps.now().getTime() + SESSION_DEFAULT_DEADLINE_HOURS * TIME_MS_PER_HOUR,
    ).toISOString();
    const contextResult = await this.applyDogfoodContext(input, delegationTraceId, model);
    const brief = await this.deps.delegateService.prepareBrief({
      traceId: delegationTraceId,
      parentTraceId: input.parentTraceId,
      parentStepId: input.parentStepId,
      sequence: input.sequence,
      agentRole: input.agentRole,
      gate: SessionGateSchema.enum.code_changes,
      tool: config.tool,
      objective: contextResult.objective,
      acceptanceCriteria: input.acceptanceCriteria,
      artifactRef: input.artifactRef,
      permittedPaths: config.permitted_paths ?? LEGACY_PERMITTED_PATHS,
      worktreePath: input.worktreePath,
      tokenBudget: config.token_budget ?? {
        max_input_tokens: SESSION_DEFAULT_MAX_INPUT_TOKENS,
        max_output_tokens: SESSION_DEFAULT_MAX_OUTPUT_TOKENS,
        max_total_tokens: SESSION_DEFAULT_MAX_TOTAL_TOKENS,
      },
      deadline,
      ...(model ? { model } : {}),
    });
    return { brief, recordId: contextResult.recordId, connection: contextResult.connection };
  }

  /** Absent contextPort returns `input.objective` unchanged (byte-for-byte); acceptance
   *  criteria and artifactRef are never touched. A prepare() failure propagates to
   *  `delegate`'s existing try/catch, mapping to the `launch_failed` terminal outcome. */
  private async applyDogfoodContext(
    input: ISessionDelegationRequest,
    delegationTraceId: string,
    model: Opt<string, Reason.OptionalContext>,
  ): Promise<{ objective: string; recordId?: string; connection?: IDogfoodContextConnection }> {
    if (!this.deps.contextPort) return { objective: input.objective };

    const handle = await this.deps.contextPort.prepare({
      executionTraceId: delegationTraceId,
      parentTraceId: input.parentTraceId,
      stepId: input.parentStepId,
      sequence: input.sequence,
      turn: 0,
      attempt: 1,
      surface: "session_delegate_cycle",
      model: model ?? "",
      originalPrompt: input.objective,
      queryText: input.objective,
      acceptanceCriteria: input.acceptanceCriteria,
    });
    return { objective: handle.prompt, recordId: handle.recordId, connection: handle.connection };
  }

  private async resolveLaunch(
    brief: SessionBrief,
    connection: Opt<IDogfoodContextConnection, Reason.OptionalContext>,
  ): Promise<ISessionLaunch> {
    const mcpConnection = connection ? toMcpConnectionInput(connection) : undefined;
    if (!this.deps.config.harden_permissions) {
      return this.deps.delegateService.resolveLaunch(brief, "headless");
    }
    const hardened = await this.deps.delegateService.resolveHardenedLaunch(
      brief,
      "headless",
      this.deps.config,
      mcpConnection,
    );
    if (hardened.agentNameMismatch) {
      await this.log(DomainEventType.SessionDelegateAgentMismatch, brief.trace_id, {
        tool: brief.tool,
      });
    }
    if (hardened.versionWarning) {
      await this.logger.warn(
        DomainEventType.SessionDelegateVersionWarning,
        brief.trace_id,
        { warning: hardened.versionWarning, tool: brief.tool },
        brief.trace_id,
      );
    }
    return hardened.launch;
  }

  /** The bearer credential value is merged in here (never inside resolveHardenedLaunch,
   *  which only ever writes env-var REFERENCES to config/argv) so it flows exclusively
   *  through the same explicit-env path as provider API keys. */
  private resolveProviderEnv(
    connection: Opt<IDogfoodContextConnection, Reason.OptionalContext>,
  ): Record<string, string> | undefined {
    const provider = this.deps.config.provider;
    const providerEnv = (() => {
      if (!provider) return undefined;
      const apiKey = this.deps.resolveProviderApiKey(provider.key_env);
      if (!apiKey && provider.name !== ProviderType.OLLAMA) {
        throw new Error("delegate provider credential is unavailable");
      }
      return apiKey
        ? this.deps.delegateService.resolveDelegateEnv(
          this.deps.config,
          this.deps.config.tool,
          apiKey,
        )
        : undefined;
    })();
    if (!connection) return providerEnv;
    return { ...providerEnv, [connection.bearerEnvVar]: connection.bearerToken };
  }

  private async emitLaunched(
    input: ISessionDelegationRequest,
    brief: SessionBrief,
    delegationTraceId: string,
  ): Promise<void> {
    const launched = SessionDelegateLaunchedPayloadSchema.parse({
      trace_id: delegationTraceId,
      parent_trace_id: input.parentTraceId,
      parent_step_id: input.parentStepId,
      sequence: input.sequence,
      gate: SessionGateSchema.enum.code_changes,
      tool: brief.tool,
      cycle_owned: false,
      artifact_ref: brief.artifact_ref,
    });
    await this.log(DomainEventType.SessionDelegateLaunched, delegationTraceId, {
      ...launched,
    });
  }

  private async awaitTerminal(
    input: ISessionDelegationRequest,
    brief: SessionBrief,
  ): Promise<ISessionDelegationOutcome> {
    const deadline = Date.parse(brief.deadline);
    while (this.deps.now().getTime() < deadline) {
      const outcome = await this.deps.resultStore.get(brief.trace_id);
      const wait = await this.deps.waitStore.get(brief.trace_id);
      if (outcome?.status === SessionDelegationStatusSchema.enum.rejected) return outcome;
      if (outcome && wait?.status === "resumed") return outcome;
      if (wait?.status === "expired" || wait?.status === "cancelled") {
        return this.outcomeFromWait(input, brief.trace_id, wait);
      }
      await this.deps.sleep(SESSION_DELEGATION_WAIT_POLL_MS);
    }
    try {
      await this.deps.waitStore.expire(brief.trace_id);
    } catch {
      // A concurrent terminal transition wins; the persisted state is read below.
    }
    const wait = await this.deps.waitStore.get(brief.trace_id);
    return wait
      ? this.outcomeFromWait(input, brief.trace_id, wait)
      : this.terminalOutcome(input, brief.trace_id, "expired", "delegation expired");
  }

  private outcomeFromWait(
    input: ISessionDelegationRequest,
    delegationTraceId: string,
    wait: SessionWaitState,
  ): ISessionDelegationOutcome {
    const status = wait.status === "cancelled" ? "cancelled" : "expired";
    return this.terminalOutcome(input, delegationTraceId, status, `delegation ${status}`);
  }

  private terminalOutcome(
    input: ISessionDelegationRequest,
    delegationTraceId: string,
    status: ISessionDelegationOutcome["status"],
    summary: string,
  ): ISessionDelegationOutcome {
    return SessionDelegationOutcomeSchema.parse({
      delegationTraceId,
      parentTraceId: input.parentTraceId,
      parentStepId: input.parentStepId,
      sequence: input.sequence,
      status,
      summary,
      pathsTouched: [],
      tokenStats: EMPTY_TOKEN_STATS,
    });
  }

  private async log(
    event: TDomainEventType,
    traceId: string,
    payload: ISessionDelegateEventPayload,
  ): Promise<void> {
    await this.logger.info(event, traceId, payload, traceId);
  }
}

/** Preserve PlanExecutor's existing string-sentinel callback contract. */
export function createCodeChangesDelegateAdapter(
  deps: ICodeChangesDelegateAdapterDeps,
): (
  traceId: string,
  step: IDelegatedPlanStep,
  worktreePath: string,
  agentRole: string,
) => Promise<string> {
  return async (
    traceId: string,
    step: IDelegatedPlanStep,
    worktreePath: string,
    agentRole: string,
  ): Promise<string> => {
    if (isContentlessBrief(step.content)) {
      await Promise.resolve(deps.logger.warn(
        DomainEventType.SessionDelegateContentlessBrief,
        traceId,
        {
          trace_id: traceId,
          parent_step_id: String(step.number),
          reason: "contentless delegation brief",
        },
        traceId,
      ));
      return "abandoned";
    }
    const brief = buildDelegateBriefArgs(step);
    const outcome = await deps.coordinator.delegate({
      parentTraceId: traceId,
      parentStepId: String(step.number),
      sequence: step.number,
      agentRole: agentRole,
      objective: brief.objective,
      acceptanceCriteria: brief.acceptanceCriteria ?? [],
      artifactRef: `trace:${traceId}/step:${step.number}`,
      worktreePath,
    });
    return outcome.status === SessionDelegationStatusSchema.enum.completed ? "changes_made" : "abandoned";
  };
}
