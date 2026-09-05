/**
 * @module ScenarioFrameworkUserSimulator
 * @path tests/scenario_framework/runner/user_simulator.ts
 * @description Test-side driver of the shipped clarification callback (Phase 145): an LLM,
 *   given a persona and the task's ground-truth intent, answers clarification questions the
 *   way that persona's requester would. Every answer is journaled to its own transcript for
 *   audit — the simulator never touches production code paths, only the `promptFn` callback
 *   `RequestClarifyHandler.clarify()` already exposes.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/user_simulator_test.ts, tests/scenario_framework/runner/interactive_clarification.ts]
 */

import type { IModelProvider } from "@exaix/ai";

/** Persona names the interactive pack drives the clarification loop with. Only `cooperative`
 *  has real behavior so far; `ambiguous`/`adversarial` throw until implemented. */
export type IUserSimulatorPersona = "cooperative" | "ambiguous" | "adversarial";

export interface IUserSimulatorOptions {
  provider: IModelProvider;
  persona: IUserSimulatorPersona;
  /** The task's real intent, known only to the simulator — never seen by the agent directly,
   *  only reflected through the simulator's answers. */
  groundTruthIntent: string;
}

export interface IUserSimulatorTranscriptEntry {
  questionId: string;
  questionText: string;
  answer: string;
}

const IMPLEMENTED_PERSONAS = new Set<IUserSimulatorPersona>(["cooperative"]);

function buildCooperativePrompt(groundTruthIntent: string, questionText: string): string {
  return [
    "You are the person who originally requested a coding task from an AI agent.",
    `What you actually want: ${groundTruthIntent}`,
    "The agent is asking a clarifying question before starting work. Answer it accurately,",
    "completely, and honestly, using only the information in what you actually want above.",
    "Do not invent requirements you didn't state.",
    "",
    `Question: ${questionText}`,
  ].join("\n");
}

/** Answers clarification questions through the same `promptFn` callback a human CLI user
 *  would supply — see `RequestClarifyHandler.clarify()`'s `IClarifyOptions.promptFn`. */
export class UserSimulator {
  readonly persona: IUserSimulatorPersona;
  private readonly provider: IModelProvider;
  private readonly groundTruthIntent: string;
  private readonly transcript: IUserSimulatorTranscriptEntry[] = [];

  constructor(options: IUserSimulatorOptions) {
    if (!IMPLEMENTED_PERSONAS.has(options.persona)) {
      throw new Error(`UserSimulator persona "${options.persona}" is not yet implemented`);
    }
    this.persona = options.persona;
    this.provider = options.provider;
    this.groundTruthIntent = options.groundTruthIntent;
  }

  async answer(questionText: string, questionId: string): Promise<string> {
    const prompt = buildCooperativePrompt(this.groundTruthIntent, questionText);
    const result = await this.provider.generate(prompt);
    const answer = result.content.trim();
    this.transcript.push({ questionId, questionText, answer });
    return answer;
  }

  /** A snapshot, not a live reference — mutating the returned array never affects the simulator. */
  getTranscript(): IUserSimulatorTranscriptEntry[] {
    return [...this.transcript];
  }
}
