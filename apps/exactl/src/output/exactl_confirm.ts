/**
 * @module ExaCtlConfirm
 * @path apps/exactl/src/output/exactl_confirm.ts
 * @description Asks for consent before a destructive exactl verb acts. It refuses without a terminal and journals each outcome.
 * @architectural-layer CLI
 * @dependencies [@exaix/cli, @exaix/core]
 * @related-files [apps/exactl/src/command_builders/blueprint_command.ts, packages/core/src/events/domain_event_types.ts]
 */

import { ExaCtlError, ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import type { IExaCtlGlobalOptions, IExaCtlOutputSink } from "@exaix/cli";
import { DomainEventType, type ICliConfirmationPayload } from "@exaix/core/events";
import { CliConfirmationMode, CliConfirmationOutcome } from "@exaix/core/types";
import type { IDatabaseService, IDisplayService, Opt, Reason } from "@exaix/core/types";
import { readGlobalOptions, stripTerminalControls } from "./exactl_output.ts";

/** The parts of the runtime that a confirm helper reads. */
export interface IConfirmRuntime {
  readonly display: IDisplayService;
  readonly outputSink: IExaCtlOutputSink;
  readonly services: { readonly db: Pick<IDatabaseService, "waitForFlush"> };
}

const ACCEPTED_ANSWERS: ReadonlySet<string> = new Set(["y", "yes"]);
const PROMPT_SUFFIX = " [y/N] ";
const LINE_END_BYTE = 10;
const STDIN_CHUNK_BYTES = 1;

/** The consent options of an action. They are the `yes` and `input` members of the global options. */
type IConfirmOptions = Pick<IExaCtlGlobalOptions, "input"> & Partial<Pick<IExaCtlGlobalOptions, "yes">>;

interface IExaCtlConfirmDeps {
  readonly display: IDisplayService;
  readonly sink: IExaCtlOutputSink;
  readonly isTerminal: () => boolean;
  readonly readLine: () => Promise<string>;
  /** Writes the journal rows out. A thrown failure ends the process, which would drop a pending batch. */
  readonly flush: () => Promise<void>;
}

/** Reads one line from standard input, without its line end. It returns an empty string at the end of the input. */
async function readStdinLine(): Promise<string> {
  const bytes: number[] = [];
  const chunk = new Uint8Array(STDIN_CHUNK_BYTES);
  while (await Deno.stdin.read(chunk) !== null) {
    if (chunk[0] === LINE_END_BYTE) break;
    bytes.push(chunk[0]);
  }
  return new TextDecoder().decode(new Uint8Array(bytes)).trim();
}

/** Consent for a confirming verb: `--yes`, a prompt answer on a terminal, or a refusal that names `--yes`. */
export class ExaCtlConfirm {
  constructor(private readonly deps: IExaCtlConfirmDeps) {}

  /** Returns when the verb may act. It throws USAGE when no consent is possible and CANCELLED when the answer is no. */
  async confirm(
    verb: string,
    prompt: string,
    options: IConfirmOptions,
    traceId: Opt<string, Reason.TraceAbsent> = undefined,
  ): Promise<void> {
    if (options.yes === true) {
      await this.journal(verb, CliConfirmationMode.YES, CliConfirmationOutcome.CONFIRMED, traceId);
      return;
    }
    const refusal = this.refusalMode(options);
    if (refusal !== null) {
      await this.journal(verb, refusal, CliConfirmationOutcome.REFUSED, traceId);
      throw new ExaCtlError(ExaCtlExitCode.USAGE, `${prompt} Cannot ask for confirmation here: pass --yes to confirm.`);
    }
    await this.deps.sink.err(`${stripTerminalControls(prompt)}${PROMPT_SUFFIX}`);
    const answer = (await this.deps.readLine()).trim().toLowerCase();
    if (ACCEPTED_ANSWERS.has(answer)) {
      await this.journal(verb, CliConfirmationMode.PROMPT, CliConfirmationOutcome.CONFIRMED, traceId);
      return;
    }
    await this.journal(verb, CliConfirmationMode.PROMPT, CliConfirmationOutcome.DECLINED, traceId);
    throw new ExaCtlError(ExaCtlExitCode.CANCELLED, `Cancelled: ${verb}.`);
  }

  /** Returns when a person can answer or edit here. It throws USAGE under --no-input or without a terminal. */
  async requireInput(
    verb: string,
    options: IConfirmOptions,
    traceId: Opt<string, Reason.TraceAbsent> = undefined,
  ): Promise<void> {
    const refusal = this.refusalMode(options);
    if (refusal === null) return;
    await this.journal(verb, refusal, CliConfirmationOutcome.REFUSED, traceId);
    throw new ExaCtlError(
      ExaCtlExitCode.USAGE,
      `${verb} needs a terminal: edit the file directly or run it from a terminal.`,
    );
  }

  private refusalMode(options: IConfirmOptions): CliConfirmationMode | null {
    if (options.input === false) return CliConfirmationMode.NO_INPUT;
    return this.deps.isTerminal() ? null : CliConfirmationMode.NO_TTY;
  }

  private async journal(
    verb: string,
    mode: CliConfirmationMode,
    outcome: CliConfirmationOutcome,
    traceId: Opt<string, Reason.TraceAbsent>,
  ): Promise<void> {
    const payload: ICliConfirmationPayload = { verb, mode, outcome };
    await this.deps.display.info(DomainEventType.CliConfirmationResolved, verb, { ...payload }, traceId);
    await this.deps.flush();
  }
}

/** A confirm helper over the display and the sink of a runtime, with the real terminal and standard input. */
function createExaCtlConfirm(runtime: IConfirmRuntime): ExaCtlConfirm {
  return new ExaCtlConfirm({
    display: runtime.display,
    sink: runtime.outputSink,
    isTerminal: () => Deno.stdin.isTerminal() && Deno.stderr.isTerminal(),
    readLine: readStdinLine,
    flush: () => runtime.services.db.waitForFlush(),
  });
}

/** Asks for the consent of `verb` from the merged options of an action. */
export function confirmAction(
  runtime: IConfirmRuntime,
  verb: string,
  prompt: string,
  options: object | void,
  traceId: Opt<string, Reason.TraceAbsent> = undefined,
): Promise<void> {
  return createExaCtlConfirm(runtime).confirm(verb, prompt, readGlobalOptions(options), traceId);
}

/** Refuses an action that opens an editor when nobody can use one, from the merged options of the action. */
export function requireInput(
  runtime: IConfirmRuntime,
  verb: string,
  options: object | void,
  traceId: Opt<string, Reason.TraceAbsent> = undefined,
): Promise<void> {
  return createExaCtlConfirm(runtime).requireInput(verb, readGlobalOptions(options), traceId);
}
