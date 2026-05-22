/**
 * @module RequestClarifyHandler
 * @path src/cli/handlers/request_clarify_handler.ts
 * @description Handles the `exactl request clarify` command: displays pending
 * clarification questions, submits answers through the ClarificationEngine,
 * and manages proceed/cancel lifecycle transitions for REFINING requests.
 * @architectural-layer CLI
 * @related-files [src/cli/commands/request_commands.ts, src/services/adapters/clarification_adapter.ts]
 */

import { join } from "@std/path";
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { ClarificationAdapter } from "../../services/adapters/clarification_adapter.ts";
import {
  ClarificationSessionStatus,
  type IClarificationQuestion,
  type IClarificationSession,
} from "@exaix/schemas/clarification_session.ts";
import { ClarifyResultStatus } from "@exaix/core";
import { RequestStatus } from "@exaix/core/status";

/** Minimal engine interface used for DI (test stubs or real ClarificationEngine). */
export interface IClarificationEngineForCLI {
  processAnswers(
    session: IClarificationSession,
    answers: Record<string, string>,
  ): Promise<IClarificationSession>;
  isComplete(session: IClarificationSession): boolean;
  cancel(session: IClarificationSession): IClarificationSession;
}

export interface IClarifyOptions {
  /** Answer specific questions by question ID. */
  answers?: Record<string, string>;
  /** Force proceed — accept current best-effort body and re-queue request. */
  proceed?: boolean;
  /** Cancel clarification and re-queue request as-is. */
  cancel?: boolean;
  /**
   * Interactive mode — prompt the user for each question in the current round
   * sequentially and submit the collected answers automatically.
   */
  interactive?: boolean;
  /**
   * Custom prompt function used in interactive mode.
   * Receives the question text and question ID; returns the user's answer or
   * `null` if the user skips.  Defaults to `prompt()` when absent.
   * Injected in tests to avoid real stdin.
   */
  promptFn?: (questionText: string, questionId: string) => Promise<string | null>;
  /** Injected engine (for tests). When absent the handler skips processAnswers calls. */
  engine?: IClarificationEngineForCLI;
}

export interface IClarifyResult {
  /** High-level outcome of the clarify operation. */
  status: ClarifyResultStatus;
  /** Pending questions from the most recent round (present when status is QUESTIONS). */
  questions?: IClarificationQuestion[];
  /** Current round number. */
  round?: number;
  /** Latest quality score from qualityHistory (undefined if no history). */
  score?: number;
}

const TERMINAL_STATUSES = new Set<ClarificationSessionStatus>([
  ClarificationSessionStatus.AGENT_SATISFIED,
  ClarificationSessionStatus.USER_CONFIRMED,
  ClarificationSessionStatus.MAX_ROUNDS,
  ClarificationSessionStatus.USER_CANCELLED,
]);

export class RequestClarifyHandler extends BaseCommand {
  private persistence: ClarificationAdapter;
  private workspaceRequestsDir: string;

  constructor(context: ICommandContext) {
    super(context);
    const cfg = context.config.getAll();
    this.workspaceRequestsDir = join(
      cfg.system.root,
      cfg.paths.workspace,
      cfg.paths.requests,
    );
    this.persistence = new ClarificationAdapter();
  }

  async clarify(requestId: string, options: IClarifyOptions = {}): Promise<IClarifyResult> {
    const filePath = join(this.workspaceRequestsDir, `${requestId}.md`);
    const session = await this.persistence.load(filePath);

    if (!session) {
      return { status: ClarifyResultStatus.NO_SESSION };
    }

    const latestScore = session.qualityHistory.at(-1)?.score;

    // --cancel: mark session cancelled and re-queue
    if (options.cancel) {
      const cancelled = options.engine
        ? options.engine.cancel(session)
        : { ...session, status: ClarificationSessionStatus.USER_CANCELLED };
      await this.persistence.save(filePath, cancelled);
      await this._setStatus(filePath, RequestStatus.PENDING);
      return { status: ClarifyResultStatus.CANCELLED, score: latestScore };
    }

    // --proceed: mark session user-confirmed and re-queue
    if (options.proceed) {
      const confirmed: IClarificationSession = {
        ...session,
        status: ClarificationSessionStatus.USER_CONFIRMED,
      };
      await this.persistence.save(filePath, confirmed);
      await this._setStatus(filePath, RequestStatus.PENDING);
      return { status: ClarifyResultStatus.COMPLETE, score: latestScore };
    }

    // --interactive: prompt for each question sequentially, then submit answers
    if (options.interactive && options.engine) {
      const currentQuestions = session.rounds.at(-1)?.questions ?? [];
      const defaultPromptFn = (questionText: string, _id: string): Promise<string | null> =>
        Promise.resolve(prompt(questionText));
      const ask = options.promptFn ?? defaultPromptFn;

      const answers: Record<string, string> = {};
      for (const q of currentQuestions) {
        const answer = await ask(q.question, q.id);
        if (answer !== null && answer !== "") {
          answers[q.id] = answer;
        }
      }

      return this._processAnswersAndReturnResult(filePath, session, answers, options.engine);
    }

    // --answers: submit answers and advance session
    if (options.answers && options.engine) {
      return this._processAnswersAndReturnResult(filePath, session, options.answers, options.engine);
    }

    // Default: display current pending questions
    const currentRound = session.rounds.at(-1);
    return {
      status: ClarifyResultStatus.QUESTIONS,
      questions: currentRound?.questions,
      round: currentRound?.round,
      score: latestScore,
    };
  }

  /** Process answers and return clarification result */
  private async _processAnswersAndReturnResult(
    filePath: string,
    session: IClarificationSession,
    answers: Record<string, string>,
    engine: IClarificationEngineForCLI,
  ): Promise<IClarifyResult> {
    const updated = await engine.processAnswers(session, answers);
    await this.persistence.save(filePath, updated);

    if (TERMINAL_STATUSES.has(updated.status)) {
      await this._setStatus(filePath, RequestStatus.PENDING);
      return { status: ClarifyResultStatus.COMPLETE, score: updated.qualityHistory.at(-1)?.score };
    }

    const latestRound = updated.rounds.at(-1);
    return {
      status: ClarifyResultStatus.QUESTIONS,
      questions: latestRound?.questions,
      round: latestRound?.round,
      score: updated.qualityHistory.at(-1)?.score,
    };
  }

  /** Update the `status:` field in a request file's YAML frontmatter. */
  private async _setStatus(filePath: string, newStatus: string): Promise<void> {
    const content = await Deno.readTextFile(filePath);
    const updated = content.replace(/^(status:\s*).+$/m, `$1${newStatus}`);
    await Deno.writeTextFile(filePath, updated);
  }
}
