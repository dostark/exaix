#!/usr/bin/env -S deno run -A
/**
 * @module Phase234SemanticCalibration
 * @path tests/scenario_framework/runner/skill_semantic_calibration.ts
 * @description Runs the fixed blind Phase 234 semantic judge on the approved reference set.
 * @architectural-layer Test
 * @related-files [
 *   "tests/scenario_framework/fixtures/skill_eval/phase234/calibration/reference_set.json"
 * ]
 */
import { CliDelegateModelProvider } from "@exaix/ai-clidelegate";
import { computeCohenKappa, computeExactAgreement } from "@exaix/eval-history";
import { REPO_ROOT } from "@exaix/testing";
import type { Opt, Reason } from "@exaix/core/types";

const REFERENCE_SET =
  `${REPO_ROOT}/tests/scenario_framework/fixtures/skill_eval/phase234/calibration/reference_set.json`;
const RUBRIC_MAP = `${REPO_ROOT}/exaix-dev-docs/planning/phase-234-case-rubric-mapping.md`;
const RESULT = `${REPO_ROOT}/tests/scenario_framework/fixtures/skill_eval/phase234/calibration/calibration_result.json`;
const EVALUATOR = "phase234-semantic-calibration-v1";
const MODEL = "claude-sonnet-4-6";

interface IReferenceEntry {
  id: string;
  caseId: string;
  turn: string;
  kind: string;
  label: string;
  artifact: string;
  pairId: string | null;
}

interface IRubricRow {
  oracle: string;
  control: string;
}

interface ICalibrationEntryResult {
  id: string;
  caseId: string;
  turn: string;
  candidateLabel: string;
  predicted: "pass" | "fail" | "error";
  rationale: string;
  verdictText: string;
}

interface ICalibrationResult {
  evaluator: string;
  model: string;
  scriptSha256: string;
  rubricSha256: string;
  reviewedSetSha256: string;
  status: string;
  entries: ICalibrationEntryResult[];
  exactAgreement: { value: number | null; reason?: string };
  cohenKappa: { value: number | null; reason?: string };
}

function sha256(text: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

function rubricRows(markdown: string): Map<string, IRubricRow> {
  const rows = new Map<string, IRubricRow>();
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 5 || !cells[1].startsWith("p234-s")) continue;
    rows.set(cells[1], { oracle: cells[2], control: cells[3] });
  }
  return rows;
}

function buildPrompt(entry: IReferenceEntry, rubric: IRubricRow, prior: Opt<string, Reason.OptionalInput>): string {
  const priorBlock = prior === undefined ? "" : `\nPrior artifact (the initial turn):\n${prior}\n`;
  return `You are a blind semantic evaluator for one Phase 234 case.

Case: ${entry.caseId}

Rubric:
${rubric.oracle}

Named bad control that must not be accepted:
${rubric.control}

Artifact:
${entry.artifact}
${priorBlock}
Decide only whether the artifact satisfies the rubric and does not exhibit the named bad control.
Use only the artifact text. Do not assume success.
Answer with exactly one verdict line: VERDICT: PASS or VERDICT: FAIL.
Then write one short rationale sentence.`;
}

function parseVerdict(text: string): { predicted: "pass" | "fail" | "error"; rationale: string } {
  const verdict = /VERDICT:\s*(PASS|FAIL)/i.exec(text);
  const rationale = text.replace(/VERDICT:\s*(PASS|FAIL)/i, "").trim().slice(0, 500);
  if (!verdict) return { predicted: "error", rationale: rationale || "No verdict line" };
  return { predicted: verdict[1].toLowerCase() === "pass" ? "pass" : "fail", rationale };
}

async function main(): Promise<void> {
  const limitArg = Deno.args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(Deno.args[limitArg + 1]) : undefined;
  const reference = JSON.parse(await Deno.readTextFile(REFERENCE_SET)) as {
    entries: IReferenceEntry[];
    reviewRecord: { reviewedSetSha256: string };
    rubricSha256: string;
  };
  const rubric = rubricRows(await Deno.readTextFile(RUBRIC_MAP));
  const script = await Deno.readTextFile(new URL(import.meta.url));
  const provider = new CliDelegateModelProvider({
    tool: "claude-code",
    bin: "claude",
    model: MODEL,
    cwd: REPO_ROOT,
  });
  const entries: ICalibrationEntryResult[] = [];
  const selected = limit === undefined ? reference.entries : reference.entries.slice(0, limit);
  for (const entry of selected) {
    const row = rubric.get(entry.caseId);
    if (!row) throw new Error(`No rubric row for ${entry.caseId}`);
    const prior = entry.turn === "answered"
      ? reference.entries.find((candidate) =>
        candidate.caseId === entry.caseId && candidate.turn === "initial" && candidate.kind === "positive"
      )?.artifact
      : undefined;
    const prompt = buildPrompt(entry, row, prior);
    const result = await provider.generate(prompt);
    const verdict = parseVerdict(result.content);
    entries.push({
      id: entry.id,
      caseId: entry.caseId,
      turn: entry.turn,
      candidateLabel: entry.label,
      predicted: verdict.predicted,
      rationale: verdict.rationale,
      verdictText: result.content.slice(0, 800),
    });
    console.log(`${entry.id}: candidate=${entry.label} predicted=${verdict.predicted}`);
    const pairs = entries.filter((item) => item.predicted !== "error").map((item) => ({
      id: item.id,
      targetScore: item.candidateLabel === "passed" ? 1 : 0,
      referenceScore: item.predicted === "pass" ? 1 : 0,
    }));
    const exact = computeExactAgreement(pairs, 0.5);
    const kappa = computeCohenKappa(pairs, 0.5);
    const output: ICalibrationResult = {
      evaluator: EVALUATOR,
      model: MODEL,
      scriptSha256: await sha256(script),
      rubricSha256: reference.rubricSha256,
      reviewedSetSha256: reference.reviewRecord.reviewedSetSha256,
      status: "diagnostic-pending-independent-approval",
      entries,
      exactAgreement: exact,
      cohenKappa: kappa,
    };
    await Deno.writeTextFile(RESULT, `${JSON.stringify(output, null, 2)}\n`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(`Wrote ${RESULT} with ${entries.length} entries`);
}

if (import.meta.main) await main();
