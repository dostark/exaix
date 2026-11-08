/**
 * @module ApprovalCommands
 * @path apps/exactl/src/commands/approval_commands.ts
 * @description CLI commands that list every pending human decision and show or decide the runtime gates: wait states and tool confirmations.
 * @architectural-layer CLI
 * @dependencies [apps/exactl/src/commands/wait_state_commands.ts, apps/exactl/src/commands/tool_commands.ts, apps/exactl/src/commands/approval_id.ts, apps/exactl/src/commands/approval_sources.ts]
 * @related-files [apps/exactl/src/command_builders/approval_command.ts, apps/exactl/src/exactl.ts]
 * @visible
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { ExaCtlError, ExaCtlExitCode } from "../exactl_errors.ts";
import { ExaCtlVerb } from "../exactl_constants.ts";
import { quoteForShell } from "../exactl_renames.ts";
import { ApprovalKind, type IApprovalRef, ownerCommand, parseApprovalId, parseApprovalKinds } from "./approval_id.ts";
import {
  APPROVAL_PENDING_STATUS,
  type IApprovalListEntry,
  type IApprovalSource,
  WAIT_KIND_CLARIFICATION,
} from "./approval_sources.ts";
import type { ToolCommands } from "./tool_commands.ts";
import type { WaitStateCommands } from "./wait_state_commands.ts";

export interface IApprovalDecision {
  readonly kind: ApprovalKind;
  readonly id: string;
  readonly status: string;
  /** Wait state id for a wait ref, null for a tool ref. */
  readonly waitStateId: string | null;
}

export interface IApprovalDetail {
  readonly kind: ApprovalKind;
  readonly id: string;
  readonly fields: Record<string, string>;
}

export interface IApprovalDecisionOptions {
  readonly message?: Opt<string, Reason.OptionalInput>;
  readonly reason?: Opt<string, Reason.OptionalInput>;
  readonly resolvedBy?: Opt<string, Reason.OptionalInput>;
}

interface IApprovalListOptions {
  readonly status?: Opt<string, Reason.QueryFilter>;
  /** Kind names from `--kind`. Empty or unset lists every kind. */
  readonly kinds?: Opt<readonly string[], Reason.QueryFilter>;
}

interface IRuntimeRef extends IApprovalRef {
  readonly kind: ApprovalKind.WAIT | ApprovalKind.TOOL;
}

type WaitVerb = ExaCtlVerb.AMEND | ExaCtlVerb.EXPIRE | ExaCtlVerb.CANCEL;

const TOOL_APPROVED_STATUS = "approved";
const TOOL_DENIED_STATUS = "denied";

/** The longest time that one source may take for `approval list`. A source that takes longer is reported and skipped. */
export const APPROVAL_SOURCE_TIMEOUT_MS = 30_000;

/** A source did not settle within its limit. Its work may still run. */
class ApprovalSourceTimeoutError extends Error {
  constructor(limitMs: number) {
    super(`timed out after ${limitMs} ms`);
    this.name = "ApprovalSourceTimeoutError";
  }
}

/** Rejects when the promise has not settled within the limit. The timer is always cleared. */
async function withTimeout<T>(work: Promise<T>, limitMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ApprovalSourceTimeoutError(limitMs)), limitMs);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** A clarification wait state is shown once, as the clarification row of its trace. */
function withoutShadowedClarifications(entries: IApprovalListEntry[]): IApprovalListEntry[] {
  const clarifiedTraces = new Set(
    entries.filter((entry) => entry.kind === ApprovalKind.CLARIFICATION && entry.trace_id !== undefined)
      .map((entry) => entry.trace_id),
  );
  return entries.filter((entry) =>
    !(entry.kind === ApprovalKind.WAIT && entry.wait_kind === WAIT_KIND_CLARIFICATION &&
      clarifiedTraces.has(entry.trace_id))
  );
}

/** Oldest first. A row without a timestamp lists last. */
function sortByCreation(entries: IApprovalListEntry[]): IApprovalListEntry[] {
  return entries.sort((a, b) => {
    if (a.created_at === b.created_at) return 0;
    if (a.created_at === "") return 1;
    if (b.created_at === "") return -1;
    return a.created_at.localeCompare(b.created_at);
  });
}

export class ApprovalCommands extends BaseCommand {
  constructor(
    context: ICommandContext,
    private readonly waitStates: WaitStateCommands,
    private readonly tools: ToolCommands,
    private readonly sources: readonly IApprovalSource[],
    private readonly sourceTimeoutMs: number,
  ) {
    super(context);
  }

  private timedOut = false;

  /** True when a source of the last `list` call timed out. Its work may keep the process alive. */
  get sourceTimedOut(): boolean {
    return this.timedOut;
  }

  /** Runs the selected sources in parallel. A failing source becomes one stderr line and hides no other rows. */
  async list(options: IApprovalListOptions): Promise<IApprovalListEntry[]> {
    const status = options.status ?? APPROVAL_PENDING_STATUS;
    const kinds = parseApprovalKinds(options.kinds ?? []);
    const selected = this.sources.filter((source) => kinds.length === 0 || kinds.includes(source.kind));
    const settled = await Promise.allSettled(
      selected.map((source) => withTimeout(source.list(status), this.sourceTimeoutMs)),
    );
    this.timedOut = settled.some((result) =>
      result.status === "rejected" && result.reason instanceof ApprovalSourceTimeoutError
    );
    const entries: IApprovalListEntry[] = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        entries.push(...result.value);
        return;
      }
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`approval list: ${selected[index].kind} approvals unavailable: ${reason}`);
    });
    return sortByCreation(withoutShadowedClarifications(entries));
  }

  async show(rawId: string): Promise<IApprovalDetail> {
    const ref = await this.resolve(rawId, ExaCtlVerb.SHOW);
    if (ref.kind === ApprovalKind.TOOL) {
      const request = (await this.tools.listPending()).find((entry) => entry.id === ref.id);
      if (!request) throw new ExaCtlError(ExaCtlExitCode.NOT_FOUND, `No pending tool confirmation: ${ref.id}`);
      return {
        kind: ref.kind,
        id: ref.id,
        fields: {
          id: request.id,
          toolName: request.toolName,
          stepId: request.stepId ?? "",
          traceId: request.traceId,
          requestedAt: request.requestedAt,
          expiresAt: request.expiresAt,
          args: JSON.stringify(request.args),
        },
      };
    }
    const wait = (await this.waitStates.list()).find((entry) => entry.resumeToken === ref.id);
    if (!wait) throw new ExaCtlError(ExaCtlExitCode.NOT_FOUND, `No wait state for resume token: ${ref.id}`);
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(wait)) if (value !== undefined) fields[key] = String(value);
    return { kind: ref.kind, id: ref.id, fields };
  }

  async approve(rawId: string, options: IApprovalDecisionOptions): Promise<IApprovalDecision> {
    const ref = await this.resolve(rawId, ExaCtlVerb.APPROVE);
    if (ref.kind === ApprovalKind.TOOL) {
      await this.tools.confirm(ref.id);
      return { kind: ref.kind, id: ref.id, status: TOOL_APPROVED_STATUS, waitStateId: null };
    }
    const updated = await this.waitStates.approve(ref.id, options.message, await this.actor(options));
    return { kind: ref.kind, id: ref.id, status: updated.status, waitStateId: updated.waitStateId };
  }

  async reject(rawId: string, options: IApprovalDecisionOptions): Promise<IApprovalDecision> {
    const ref = await this.resolve(rawId, ExaCtlVerb.REJECT);
    if (ref.kind === ApprovalKind.TOOL) {
      await this.tools.deny(ref.id, options.reason ?? undefined);
      return { kind: ref.kind, id: ref.id, status: TOOL_DENIED_STATUS, waitStateId: null };
    }
    const updated = await this.waitStates.reject(ref.id, options.reason, await this.actor(options));
    return { kind: ref.kind, id: ref.id, status: updated.status, waitStateId: updated.waitStateId };
  }

  amend(rawId: string, options: IApprovalDecisionOptions): Promise<IApprovalDecision> {
    return this.decideWait(ExaCtlVerb.AMEND, rawId, options);
  }

  expire(rawId: string, options: IApprovalDecisionOptions): Promise<IApprovalDecision> {
    return this.decideWait(ExaCtlVerb.EXPIRE, rawId, options);
  }

  cancel(rawId: string, options: IApprovalDecisionOptions): Promise<IApprovalDecision> {
    return this.decideWait(ExaCtlVerb.CANCEL, rawId, options);
  }

  private async decideWait(
    verb: WaitVerb,
    rawId: string,
    options: IApprovalDecisionOptions,
  ): Promise<IApprovalDecision> {
    const ref = await this.resolve(rawId, verb);
    if (ref.kind === ApprovalKind.TOOL) {
      throw new ExaCtlError(ExaCtlExitCode.USAGE, `exactl approval ${verb} acts on wait: refs only.`);
    }
    const updated = await this.waitStates[verb](ref.id, options.message, await this.actor(options));
    return { kind: ref.kind, id: ref.id, status: updated.status, waitStateId: updated.waitStateId };
  }

  /** Every wait decision names an actor, because the wait state journals its resolution only then. */
  private async actor(options: IApprovalDecisionOptions): Promise<string> {
    return options.resolvedBy ?? await this.getUserIdentity();
  }

  private async resolve(rawId: string, verb: ExaCtlVerb): Promise<IRuntimeRef> {
    const parsed = parseApprovalId(rawId);
    if (parsed.kind === undefined) return await this.resolveBare(parsed.id);
    if (parsed.kind === ApprovalKind.WAIT || parsed.kind === ApprovalKind.TOOL) {
      return { kind: parsed.kind, id: parsed.id };
    }
    const owner = verb === ExaCtlVerb.APPROVE || verb === ExaCtlVerb.REJECT ? ownerCommand(parsed, verb) : undefined;
    throw new ExaCtlError(
      ExaCtlExitCode.USAGE,
      owner === undefined
        ? `exactl approval ${verb} acts on wait: and tool: refs only.`
        : `${parsed.kind} approvals are decided with '${owner}'.`,
    );
  }

  /** A bare id resolves over the wait and tool sources and only when exactly one of them holds it. */
  private async resolveBare(id: string): Promise<IRuntimeRef> {
    const refs: IRuntimeRef[] = [];
    if ((await this.waitStates.list()).some((wait) => wait.resumeToken === id)) {
      refs.push({ kind: ApprovalKind.WAIT, id });
    }
    if ((await this.tools.listPending()).some((tool) => tool.id === id)) refs.push({ kind: ApprovalKind.TOOL, id });
    if (refs.length === 0) {
      throw new ExaCtlError(
        ExaCtlExitCode.NOT_FOUND,
        `No wait state or pending tool confirmation matches ${quoteForShell(id)}.`,
      );
    }
    if (refs.length > 1) {
      const typed = refs.map((ref) => `${ref.kind}:${ref.id}`).join(", ");
      throw new ExaCtlError(
        ExaCtlExitCode.USAGE,
        `${quoteForShell(id)} matches several approvals: ${typed}. Pass the typed id.`,
      );
    }
    return refs[0];
  }
}
