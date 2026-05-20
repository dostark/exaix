/**
 * @module ClarificationEngine
 * @path packages/quality-gate/src/clarification_engine.ts
 * @description Multi-turn clarification Q&A loop engine. Drives iterative
 * planning-agent questioning to refine underspecified requests into structured
 * IRequestSpecification objects. Supports up to `maxRounds` rounds before
 * finalizing with a best-effort specification.
 * @architectural-layer Domain
 * @related-files [packages/quality-gate/src/mod.ts, "packages/core/src/types/i_request_quality_gate_service.ts"]
 */

import { z } from "zod";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IOutputValidator } from "./internal_types.ts";
import {
  ClarificationQuestionSchema,
  ClarificationSessionStatus,
  type IClarificationQuestion,
  type IClarificationRound,
  type IClarificationSession,
} from "@exaix/schemas/clarification_session.ts";
import { RequestSpecificationSchema } from "@exaix/schemas/request_specification.ts";
import { assessHeuristic } from "./heuristic_assessor.ts";
/** Configuration for the clarification engine. */
export interface IClarificationEngineConfig {
  /** Maximum clarification rounds before forced finalisation. */
  maxRounds: number;
}

// ---------------------------------------------------------------------------
// LLM response schema
// ---------------------------------------------------------------------------

const ClarificationLlmResponseSchema = z.object({
  satisfied: z.boolean(),
  refinedBody: RequestSpecificationSchema.optional(),
  questions: z.array(ClarificationQuestionSchema).optional(),
});

type IClarificationLlmResponse = z.infer<typeof ClarificationLlmResponseSchema>;

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

/** Maximum words per question section; keep prompts concise. */
const MAX_HISTORY_ENTRIES = 5;

function buildRoundPrompt(
  originalBody: string,
  session: IClarificationSession,
  roundNumber: number,
): string {
  const historyLines = session.rounds.map((r) => {
    const qs = r.questions.map((q) => `  - [${q.id}] ${q.question}`).join("\n");
    const as = r.answers
      ? Object.entries(r.answers).map(([k, v]) => `  - [${k}] ${v}`).join("\n")
      : "  (no answers yet)";
    return `Round ${r.round} questions:\n${qs}\nUser answers:\n${as}`;
  }).slice(-MAX_HISTORY_ENTRIES).join("\n\n");

  return `You are a planning agent refining a software request.

Original request:
"""
${originalBody}
"""

Conversation history:
${historyLines || "(no previous rounds)"}

This is round ${roundNumber}. Analyse the request and conversation.

If the request is now well-specified (has clear goals, scope, and success criteria), respond with:
{"satisfied":true,"refinedBody":{structured specification}}

Otherwise, generate 2-4 targeted questions to fill remaining gaps. Respond with:
{"satisfied":false,"questions":[{question objects}]}

Each question must include: id (format r${roundNumber}q<N>, 1-based), question (string), rationale (string), category (one of: goal, scope, constraint, acceptance, context, priority), required (boolean).`;
}

// ---------------------------------------------------------------------------
// ClarificationEngine
// ---------------------------------------------------------------------------

/**
 * Manages multi-turn clarification Q&A sessions between the planning agent
 * (LLM) and the user, iterating until the agent is satisfied or max rounds
 * are reached.
 */
export class ClarificationEngine {
  private readonly provider: IModelProvider;
  private readonly validator: IOutputValidator;
  private readonly config: IClarificationEngineConfig;

  constructor(
    provider: IModelProvider,
    validator: IOutputValidator,
    config: IClarificationEngineConfig,
  ) {
    this.provider = provider;
    this.validator = validator;
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Creates a new clarification session and generates Round 1 questions.
   * Falls back to an empty round if the LLM is unavailable.
   */
  async startSession(
    requestId: string,
    body: string,
  ): Promise<IClarificationSession> {
    const heuristic = assessHeuristic(body);

    const session: IClarificationSession = {
      requestId,
      originalBody: body,
      rounds: [],
      status: ClarificationSessionStatus.ACTIVE,
      qualityHistory: [{ round: 0, score: heuristic.score, level: heuristic.level }],
    };

    const round1 = await this._generateRound(session, 1);
    return { ...session, rounds: [round1] };
  }

  /**
   * Incorporates user answers into the current round, then either finalises
   * the session (agent satisfied or max rounds) or adds the next round.
   */
  async processAnswers(
    session: IClarificationSession,
    answers: Record<string, string>,
  ): Promise<IClarificationSession> {
    const currentRoundIdx = session.rounds.length - 1;
    const updatedRounds = session.rounds.map((r, i) =>
      i === currentRoundIdx ? { ...r, answers, answeredAt: new Date().toISOString() } : r
    );
    const updatedSession = { ...session, rounds: updatedRounds };
    // Ask LLM whether it is now satisfied
    const llmResponse = await this._callLlm(updatedSession, updatedRounds.length + 1);

    if (llmResponse.satisfied && llmResponse.refinedBody) {
      const newHistory = [
        ...updatedSession.qualityHistory,
        { round: updatedRounds.length, score: 90, level: "excellent" },
      ];
      return {
        ...updatedSession,
        refinedBody: llmResponse.refinedBody,
        status: ClarificationSessionStatus.AGENT_SATISFIED,
        qualityHistory: newHistory,
      };
    }

    // Max rounds reached — finalise with best effort
    if (updatedRounds.length >= this.config.maxRounds) {
      return { ...updatedSession, status: ClarificationSessionStatus.MAX_ROUNDS };
    }

    // Add next round with LLM-generated questions
    const nextRoundNumber = updatedRounds.length + 1;
    const nextQuestions = llmResponse.questions ?? [];
    const nextRound: IClarificationRound = {
      round: nextRoundNumber,
      questions: nextQuestions,
      askedAt: new Date().toISOString(),
    };
    const newHistory = [
      ...updatedSession.qualityHistory,
      { round: updatedRounds.length, score: 55, level: "acceptable" },
    ];
    return {
      ...updatedSession,
      rounds: [...updatedRounds, nextRound],
      qualityHistory: newHistory,
    };
  }

  /** Returns true when the session is in a terminal state. */
  isComplete(session: IClarificationSession): boolean {
    return session.status !== ClarificationSessionStatus.ACTIVE;
  }

  /** Marks the session as user-cancelled (synchronous, no LLM call). */
  cancel(session: IClarificationSession): IClarificationSession {
    return { ...session, status: ClarificationSessionStatus.USER_CANCELLED };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Generates a new round by calling the planning agent. Falls back to an
   * empty-questions round if the LLM fails or returns invalid JSON.
   */
  private async _generateRound(
    session: IClarificationSession,
    roundNumber: number,
  ): Promise<IClarificationRound> {
    const fallbackRound: IClarificationRound = {
      round: roundNumber,
      questions: [],
      askedAt: new Date().toISOString(),
    };

    const response = await this._callLlm(session, roundNumber);
    const questions: IClarificationQuestion[] = response.questions ?? [];

    return { ...fallbackRound, questions };
  }

  /** Calls the LLM, validates response schema, and returns a structured result. */
  private async _callLlm(
    session: IClarificationSession,
    nextRoundNumber: number,
  ): Promise<IClarificationLlmResponse> {
    const prompt = buildRoundPrompt(session.originalBody, session, nextRoundNumber);

    let raw: string;
    try {
      const result = await this.provider.generate(prompt);
      raw = result.content;
    } catch {
      return { satisfied: false, questions: [] };
    }

    const validation = this.validator.validate(raw, ClarificationLlmResponseSchema);
    if (validation.success && validation.value) {
      return validation.value;
    }

    // Attempt direct JSON parse as fallback
    try {
      const json = JSON.parse(raw) as unknown;
      return ClarificationLlmResponseSchema.parse(json);
    } catch {
      return { satisfied: false, questions: [] };
    }
  }
}
