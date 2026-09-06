#!/usr/bin/env -S deno run -A
/**
 * @module DriveInteractiveRound
 * @path tests/scenario_framework/runner/drive_interactive_round.ts
 * @description CLI entrypoint wired into an interactive-pack live scenario as a `type: "run-script"`
 *   step, replacing the two `type: "shell"` (`bash -c`) glue steps the declarative-purity check
 *   (`scripts/check_scenario_declarative.ts`) flags: reads the current pending question from a
 *   real `exactl request clarify --json` call, submits a real answer, records that round's result,
 *   then forces a terminal resolution via `--proceed` (the real action an operator takes when a
 *   session doesn't converge in the available rounds — see Phase 145 Step 5's plan doc for why
 *   this is needed to genuinely exercise the `resolvedBy`-carrying resolution path).
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/check_interactive_result.ts, tests/scenario_framework/tests/unit/drive_interactive_round_test.ts]
 */

import { SafeSubprocess } from "@exaix/core";

const USAGE = "usage: drive_interactive_round.ts <exactlBin> <requestId> <answerText> <resolvedBy> <outputPath>";

/** `CliDelegateModelProvider` prints unconditional diagnostic `console.log` lines (e.g.
 *  "[CliDelegateModelProvider] generate start: ...") to stdout whenever it calls a real
 *  provider — this strips everything before the JSON payload's opening brace. */
export function stripDiagnosticPrefix(raw: string): string {
  const lines = raw.split("\n");
  const jsonStart = lines.findIndex((line) => line.startsWith("{"));
  if (jsonStart === -1) return raw;
  return lines.slice(jsonStart).join("\n");
}

interface IClarifyQuestionsResult {
  questions?: Array<{ id: string }>;
}

export function extractFirstQuestionId(clarifyJson: string): string {
  const parsed = JSON.parse(stripDiagnosticPrefix(clarifyJson)) as IClarifyQuestionsResult;
  const id = parsed.questions?.[0]?.id;
  if (!id) {
    throw new Error("no pending questions found in clarify result");
  }
  return id;
}

async function runExactl(exactlBin: string, args: string[]): Promise<string> {
  const result = await SafeSubprocess.run(exactlBin, args);
  if (result.code !== 0) {
    throw new Error(`exactl ${args.join(" ")} failed with code ${result.code}: ${result.stderr}`);
  }
  return result.stdout;
}

export async function main(args: string[]): Promise<number> {
  const [exactlBin, requestId, answerText, resolvedBy, outputPath] = args;
  if (!exactlBin || !requestId || !answerText || !resolvedBy || !outputPath) {
    console.error(USAGE);
    return 2;
  }

  try {
    const questionsRaw = await runExactl(exactlBin, ["request", "clarify", requestId, "--json"]);
    const questionId = extractFirstQuestionId(questionsRaw);

    const answerRaw = await runExactl(exactlBin, [
      "request",
      "clarify",
      requestId,
      "--answer",
      `${questionId}=${answerText}`,
      "--resolved-by",
      resolvedBy,
      "--json",
    ]);
    await Deno.writeTextFile(outputPath, stripDiagnosticPrefix(answerRaw));

    // The real engine may not converge within the answer round above — force a terminal
    // resolution anyway, the same action a human operator takes, so the resolvedBy-carrying
    // resolution path is genuinely exercised regardless of whether the round converged.
    await runExactl(exactlBin, ["request", "clarify", requestId, "--proceed", "--resolved-by", resolvedBy, "--json"]);

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
