/**
 * @module ApprovalId
 * @path apps/exactl/src/commands/approval_id.ts
 * @description Typed approval ids (`wait:<token>`, `tool:<id>`) and the command that owns each kind of pending decision.
 * @architectural-layer CLI
 * @dependencies [apps/exactl/src/exactl_errors.ts]
 * @related-files [apps/exactl/src/commands/approval_commands.ts, apps/exactl/src/command_builders/approval_command.ts]
 */

import { ExaCtlError, ExaCtlExitCode } from "../exactl_errors.ts";
import { ExaCtlVerb } from "../exactl_constants.ts";
import { quoteArgument, quoteForShell } from "../exactl_shell.ts";

/** Every source of a pending human decision. */
export enum ApprovalKind {
  PLAN = "plan",
  AMENDMENT = "amendment",
  REVIEW = "review",
  CLARIFICATION = "clarification",
  PROPOSAL = "proposal",
  SKILL = "skill",
  WAIT = "wait",
  TOOL = "tool",
}

export interface IApprovalRef {
  readonly kind: ApprovalKind;
  readonly id: string;
}

/** An id without a `kind:` prefix. The caller resolves it over the `wait` and `tool` sources. */
export interface IBareApprovalId {
  readonly kind: undefined;
  readonly id: string;
}

const KIND_SEPARATOR = ":";
const KINDS: readonly string[] = Object.values(ApprovalKind);

/** Parses `kind:id`. A bare id is returned as `IBareApprovalId`. An unknown prefix is a usage error. */
export function parseApprovalId(raw: string): IApprovalRef | IBareApprovalId {
  const separator = raw.indexOf(KIND_SEPARATOR);
  const kind = separator === -1 ? undefined : raw.slice(0, separator);
  const id = (separator === -1 ? raw : raw.slice(separator + 1)).trim();
  if (id.length === 0) throw new ExaCtlError(ExaCtlExitCode.USAGE, "Approval id is empty.");
  if (kind === undefined) return { kind: undefined, id };
  if (!KINDS.includes(kind)) {
    throw new ExaCtlError(
      ExaCtlExitCode.USAGE,
      `Unknown approval kind ${quoteForShell(kind)}. Use one of: ${KINDS.join(", ")}.`,
    );
  }
  return { kind: kind as ApprovalKind, id };
}

/** Parses the values of `--kind`. An unknown kind is a usage error. */
export function parseApprovalKinds(raw: readonly string[]): ApprovalKind[] {
  const kinds: ApprovalKind[] = [];
  for (const value of raw.map((item) => item.trim()).filter((item) => item.length > 0)) {
    if (!KINDS.includes(value)) {
      throw new ExaCtlError(
        ExaCtlExitCode.USAGE,
        `Unknown approval kind ${quoteForShell(value)}. Use one of: ${KINDS.join(", ")}.`,
      );
    }
    kinds.push(value as ApprovalKind);
  }
  return kinds;
}

/** The decision verbs that a kind owned by another noun still has. */
type OwnedDecision = ExaCtlVerb.APPROVE | ExaCtlVerb.REJECT;

const OWNER_COMMANDS: Partial<Record<ApprovalKind, Record<OwnedDecision, string | undefined>>> = {
  [ApprovalKind.PLAN]: { [ExaCtlVerb.APPROVE]: "exactl plan approve", [ExaCtlVerb.REJECT]: "exactl plan reject" },
  [ApprovalKind.AMENDMENT]: {
    [ExaCtlVerb.APPROVE]: "exactl plan amendment approve",
    [ExaCtlVerb.REJECT]: "exactl plan amendment reject",
  },
  [ApprovalKind.REVIEW]: { [ExaCtlVerb.APPROVE]: "exactl review approve", [ExaCtlVerb.REJECT]: "exactl review reject" },
  [ApprovalKind.CLARIFICATION]: {
    [ExaCtlVerb.APPROVE]: "exactl request clarify",
    [ExaCtlVerb.REJECT]: "exactl request clarify",
  },
  [ApprovalKind.PROPOSAL]: {
    [ExaCtlVerb.APPROVE]: "exactl memory proposal approve",
    [ExaCtlVerb.REJECT]: "exactl memory proposal reject",
  },
  [ApprovalKind.SKILL]: { [ExaCtlVerb.APPROVE]: "exactl skill approve", [ExaCtlVerb.REJECT]: undefined },
};

/** The command that decides a pending item of a kind owned by another noun. It is undefined when none exists. */
export function ownerCommand(ref: IApprovalRef, decision: OwnedDecision): string | undefined {
  const base = OWNER_COMMANDS[ref.kind]?.[decision];
  return base === undefined ? undefined : `${base} ${quoteArgument(ref.id)}`;
}
