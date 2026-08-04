/**
 * @module CheckReachabilityLedgerTest
 * @path tests/scripts/check_reachability_ledger_test.ts
 * @description Tests for scripts/check_reachability_ledger.ts — the gate that
 *   parses every phase plan doc's "Reachability Ledger" table(s) and, for each row
 *   marked ✅, verifies the code identifiers named in its "Production call-site" cell
 *   actually have a call/reference site outside their own definition file and outside
 *   test files. Exists because phase-158's post-gap analysis (2026-08-04) found six
 *   ✅ rows whose named call-sites were never actually invoked by any committed code —
 *   this mechanizes the repo-wide grep audit that finding required by hand.
 * @architectural-layer Script (test)
 * @dependencies [@std/assert]
 * @related-files [scripts/check_reachability_ledger.ts]
 */

import { assertEquals } from "@std/assert";
import {
  auditLedgerRows,
  extractCandidateFilenames,
  extractCandidateSymbols,
  findExportDefinitionFiles,
  findFilenameReferences,
  findFilesByBasename,
  findUsageFiles,
  parseReachabilityLedgerRows,
} from "../../scripts/check_reachability_ledger.ts";
import type { IFileRecord, IReachabilityLedgerRow } from "../../scripts/check_reachability_ledger.ts";

Deno.test("[extractCandidateSymbols] finds camelCase, PascalCase, and CONSTANT_CASE identifiers", () => {
  const cell =
    "executed by the first live run (computePairedComparison over the ablation); see AgentRunner and EXA_EVAL_SUPPRESS_SKILLS";
  const found = extractCandidateSymbols(cell);
  assertEquals(found.includes("computePairedComparison"), true);
  assertEquals(found.includes("AgentRunner"), true);
  assertEquals(found.includes("EXA_EVAL_SUPPRESS_SKILLS"), true);
});

Deno.test("[extractCandidateSymbols] ignores kebab-case labels, prose, and plain all-caps words", () => {
  const cell = "closed 2026-08-03 (skill-value-live-corpus-run) — the run was GREEN and PASS";
  const found = extractCandidateSymbols(cell);
  assertEquals(found.includes("skill-value-live-corpus-run"), false);
  assertEquals(found.includes("GREEN"), false);
  assertEquals(found.includes("PASS"), false);
});

Deno.test("[extractCandidateSymbols] backtick-wrapped identifiers are still extracted", () => {
  const cell = "(`evaluateValidityGate`/`assertValidityGate` pass — the run is admitted)";
  const found = extractCandidateSymbols(cell);
  assertEquals(found.includes("evaluateValidityGate"), true);
  assertEquals(found.includes("assertValidityGate"), true);
});

Deno.test("[extractCandidateFilenames] finds snake_case.ts filename mentions", () => {
  const cell =
    "a human-triggered live run using `skill_corpus_reachability.ts`/`skill_value_plan.ts`, spending real credits";
  const found = extractCandidateFilenames(cell);
  assertEquals(found.includes("skill_corpus_reachability.ts"), true);
  assertEquals(found.includes("skill_value_plan.ts"), true);
});

Deno.test("[findFilesByBasename] matches by basename regardless of directory", () => {
  const files: IFileRecord[] = [
    { path: "tests/scenario_framework/runner/skill_value_plan.ts", content: "" },
    { path: "tests/scenario_framework/runner/skill_value_plan_test.ts", content: "" },
  ];
  assertEquals(findFilesByBasename("skill_value_plan.ts", files), [
    "tests/scenario_framework/runner/skill_value_plan.ts",
  ]);
});

Deno.test("[findFilenameReferences] a filename never imported anywhere else has no references", () => {
  const files: IFileRecord[] = [
    { path: "tests/scenario_framework/runner/skill_value_plan.ts", content: "export function planFullTrials() {}" },
  ];
  const refs = findFilenameReferences(
    "skill_value_plan.ts",
    files,
    new Set([
      "tests/scenario_framework/runner/skill_value_plan.ts",
    ]),
  );
  assertEquals(refs, []);
});

Deno.test("[findFilenameReferences] a real import elsewhere counts as a reference", () => {
  const files: IFileRecord[] = [
    { path: "tests/scenario_framework/runner/skill_value_plan.ts", content: "export function planFullTrials() {}" },
    {
      path: "scripts/run_value_report.ts",
      content: 'import { planFullTrials } from "../tests/scenario_framework/runner/skill_value_plan.ts";',
    },
  ];
  const refs = findFilenameReferences(
    "skill_value_plan.ts",
    files,
    new Set([
      "tests/scenario_framework/runner/skill_value_plan.ts",
    ]),
  );
  assertEquals(refs, ["scripts/run_value_report.ts"]);
});

Deno.test("[auditLedgerRows] flags a ✅ row that names a file never imported anywhere else", () => {
  const rows: IReachabilityLedgerRow[] = [{
    docPath: "phase-999-example.md",
    symbolLabel: "`skill-value-live-corpus-run`",
    addedIn: "Step 4",
    wiringStep: "operator-run",
    callSiteText: "a human-triggered live run using `skill_value_plan.ts` — closed 2026-08-04",
    status: "✅",
  }];
  const files: IFileRecord[] = [
    { path: "tests/scenario_framework/runner/skill_value_plan.ts", content: "export function planFullTrials() {}" },
    { path: "tests/scenario_framework/runner/skill_value_plan_test.ts", content: "planFullTrials();" },
  ];

  const findings = auditLedgerRows(rows, files);
  assertEquals(findings.length, 1);
  assertEquals(findings[0].candidateIdentifier, "skill_value_plan.ts");
});

Deno.test("[auditLedgerRows] a named file that is an import.meta.main entrypoint is not flagged for lacking an importer", () => {
  // Regression: scripts/check_artefact_decision_coverage.ts is invoked via `deno run`,
  // never imported by another module — that IS its production call-site, not a gap.
  const rows: IReachabilityLedgerRow[] = [{
    docPath: "phase-999-example.md",
    symbolLabel: "`artefact-decision-coverage`",
    addedIn: "Step 7",
    wiringStep: "Step 7",
    callSiteText: "run for real via `scripts/check_artefact_decision_coverage.ts` — closed 2026-08-04",
    status: "✅",
  }];
  const files: IFileRecord[] = [
    {
      path: "scripts/check_artefact_decision_coverage.ts",
      content: "if (import.meta.main) {\n  console.log('run');\n}",
    },
  ];

  assertEquals(auditLedgerRows(rows, files), []);
});

Deno.test("[auditLedgerRows] a named identifier called only from its own file's import.meta.main entrypoint is not flagged", () => {
  // Regression: scripts/run_value_comparison_report.ts's computeArmComparisonReport is
  // exported for testability and called by that same file's renderReport(), which is
  // itself only called from that file's import.meta.main block — a real, reachable
  // production call chain entirely inside one script, the same shape every operator-run
  // script in this repo uses (check_blueprint_integrity.ts, check_artefact_decision_coverage.ts).
  const rows: IReachabilityLedgerRow[] = [{
    docPath: "phase-999-example.md",
    symbolLabel: "`paired-arm-comparison`",
    addedIn: "Step 1",
    wiringStep: "Step 9",
    callSiteText: "wired via computeArmComparisonReport — closed 2026-08-04",
    status: "✅",
  }];
  const files: IFileRecord[] = [
    {
      path: "scripts/run_value_comparison_report.ts",
      content: [
        "export function computeArmComparisonReport() { return 1; }",
        "function renderReport() { return computeArmComparisonReport(); }",
        "if (import.meta.main) { renderReport(); }",
      ].join("\n"),
    },
  ];

  assertEquals(auditLedgerRows(rows, files), []);
});

Deno.test("[auditLedgerRows] an identifier that only appears once (its own declaration) in an entrypoint file is still flagged", () => {
  // The entrypoint exemption requires a real second occurrence (a call), not merely that
  // the defining file happens to be a script.
  const rows: IReachabilityLedgerRow[] = [{
    docPath: "phase-999-example.md",
    symbolLabel: "`some-row`",
    addedIn: "Step 1",
    wiringStep: "Step 9",
    callSiteText: "wired via unusedHelper — closed 2026-08-04",
    status: "✅",
  }];
  const files: IFileRecord[] = [
    {
      path: "scripts/some_script.ts",
      content: [
        "export function unusedHelper() { return 1; }",
        "if (import.meta.main) { console.log('entrypoint ran, but called nothing'); }",
      ].join("\n"),
    },
  ];

  const findings = auditLedgerRows(rows, files);
  assertEquals(findings.length, 1);
  assertEquals(findings[0].candidateIdentifier, "unusedHelper");
});

Deno.test("[parseReachabilityLedgerRows] parses a well-formed table under a Reachability Ledger heading", () => {
  const content = [
    "## Reachability Ledger (pending production consumers)",
    "",
    "| Symbol | Added in | Wiring step | Production call-site | Status |",
    "| --- | --- | --- | --- | --- |",
    "| `paired-arm-comparison` | Step 1 | Step 4 | closed (computePairedComparison over the ablation) | ✅ |",
    "| `flow-value-controlled-remeasurement` | Step 6 | Step 7 | blocked on phase-159 | ⏳ |",
    "",
    "## Next Section",
  ].join("\n");

  const rows = parseReachabilityLedgerRows(content, "phase-999-example.md");
  assertEquals(rows.length, 2);
  assertEquals(rows[0].symbolLabel, "`paired-arm-comparison`");
  assertEquals(rows[0].status, "✅");
  assertEquals(rows[0].callSiteText.includes("computePairedComparison"), true);
  assertEquals(rows[1].status, "⏳");
});

Deno.test("[parseReachabilityLedgerRows] parses multiple ledger tables in one doc", () => {
  const content = [
    "## Reachability Ledger",
    "| Symbol | Added in | Wiring step | Production call-site | Status |",
    "| --- | --- | --- | --- | --- |",
    "| `a` | Step 1 | Step 2 | (fooBarBaz called) | ✅ |",
    "",
    "## Something Else",
    "prose here",
    "",
    "## Reachability Ledger (pending production consumers)",
    "| Symbol | Added in | Wiring step | Production call-site | Status |",
    "| --- | --- | --- | --- | --- |",
    "| `b` | Step 3 | Step 4 | (quxQuux called) | ✅ |",
  ].join("\n");

  const rows = parseReachabilityLedgerRows(content, "phase-999-example.md");
  assertEquals(rows.length, 2);
  assertEquals(rows.map((r) => r.symbolLabel), ["`a`", "`b`"]);
});

Deno.test("[findExportDefinitionFiles] finds files exporting the identifier", () => {
  const files: IFileRecord[] = [
    { path: "packages/foo/src/bar.ts", content: "export function computeThing(x: number) { return x; }" },
    { path: "packages/foo/src/baz.ts", content: "import { computeThing } from './bar.ts';" },
  ];
  const defs = findExportDefinitionFiles("computeThing", files);
  assertEquals(defs, ["packages/foo/src/bar.ts"]);
});

Deno.test("[findExportDefinitionFiles] recognizes export const/class/interface/enum", () => {
  const files: IFileRecord[] = [
    { path: "a.ts", content: "export const FOO_BAR = 1;" },
    { path: "b.ts", content: "export class WidgetService {}" },
    { path: "c.ts", content: "export interface IWidget {}" },
    { path: "d.ts", content: "export enum WidgetKind { A, B }" },
  ];
  assertEquals(findExportDefinitionFiles("FOO_BAR", files), ["a.ts"]);
  assertEquals(findExportDefinitionFiles("WidgetService", files), ["b.ts"]);
  assertEquals(findExportDefinitionFiles("IWidget", files), ["c.ts"]);
  assertEquals(findExportDefinitionFiles("WidgetKind", files), ["d.ts"]);
});

Deno.test("[findUsageFiles] finds references outside the definition file", () => {
  const files: IFileRecord[] = [
    { path: "packages/foo/src/bar.ts", content: "export function computeThing(x: number) { return x; }" },
    { path: "packages/foo/src/baz.ts", content: "import { computeThing } from './bar.ts';\ncomputeThing(1);" },
  ];
  const usages = findUsageFiles("computeThing", files, new Set(["packages/foo/src/bar.ts"]));
  assertEquals(usages, ["packages/foo/src/baz.ts"]);
});

Deno.test("[findUsageFiles] a mention inside a comment (e.g. a JSDoc @description) is not a usage", () => {
  // Regression: this script's own module header names the functions it audits in prose,
  // which must not count as the very call-site the audit exists to verify.
  const files: IFileRecord[] = [
    { path: "packages/foo/src/bar.ts", content: "export function computeThing(x: number) { return x; }" },
    {
      path: "scripts/some_other_script.ts",
      content: [
        "/**",
        " * @description Uses computeThing internally, allegedly.",
        " */",
        "// See computeThing for details.",
        "export function unrelated() {}",
      ].join("\n"),
    },
  ];
  const usages = findUsageFiles("computeThing", files, new Set(["packages/foo/src/bar.ts"]));
  assertEquals(usages, []);
});

Deno.test("[findUsageFiles] a symbol referenced only in its own definition file has no usage", () => {
  const files: IFileRecord[] = [
    { path: "packages/foo/src/bar.ts", content: "export function computeThing(x: number) { return x; }" },
  ];
  const usages = findUsageFiles("computeThing", files, new Set(["packages/foo/src/bar.ts"]));
  assertEquals(usages, []);
});

Deno.test("[auditLedgerRows] flags a ✅ row whose named symbol has no call-site outside its own file", () => {
  const rows: IReachabilityLedgerRow[] = [{
    docPath: "phase-999-example.md",
    symbolLabel: "`paired-arm-comparison`",
    addedIn: "Step 1",
    wiringStep: "Step 4",
    callSiteText: "closed (computePairedComparison over the ablation)",
    status: "✅",
  }];
  const files: IFileRecord[] = [
    {
      path: "tests/scenario_framework/runner/arm_comparison.ts",
      content: "export function computePairedComparison() {}",
    },
    { path: "tests/scenario_framework/runner/arm_comparison_test.ts", content: "computePairedComparison();" },
  ];

  const findings = auditLedgerRows(rows, files);
  assertEquals(findings.length, 1);
  assertEquals(findings[0].candidateIdentifier, "computePairedComparison");
  assertEquals(findings[0].ledgerRowSymbol, "`paired-arm-comparison`");
});

Deno.test("[auditLedgerRows] does not flag a ✅ row whose symbol has a real non-test call-site", () => {
  const rows: IReachabilityLedgerRow[] = [{
    docPath: "phase-999-example.md",
    symbolLabel: "`artefact-decision-coverage`",
    addedIn: "Step 7",
    wiringStep: "Step 7",
    callSiteText: "closed (assertArtefactDecisionCoverage run for real)",
    status: "✅",
  }];
  const files: IFileRecord[] = [
    {
      path: "tests/scenario_framework/runner/artefact_decision_coverage.ts",
      content: "export function assertArtefactDecisionCoverage() {}",
    },
    {
      path: "scripts/check_artefact_decision_coverage.ts",
      content: "import { assertArtefactDecisionCoverage } from '../tests/x.ts';\nassertArtefactDecisionCoverage();",
    },
  ];

  const findings = auditLedgerRows(rows, files);
  assertEquals(findings, []);
});

Deno.test("[auditLedgerRows] ignores ⏳ rows — an honestly-open row is not a finding", () => {
  const rows: IReachabilityLedgerRow[] = [{
    docPath: "phase-999-example.md",
    symbolLabel: "`flow-value-controlled-remeasurement`",
    addedIn: "Step 6",
    wiringStep: "Step 7",
    callSiteText: "blocked on phase-159 (computePairedComparison will be re-run)",
    status: "⏳",
  }];
  const files: IFileRecord[] = [
    {
      path: "tests/scenario_framework/runner/arm_comparison.ts",
      content: "export function computePairedComparison() {}",
    },
  ];

  assertEquals(auditLedgerRows(rows, files), []);
});

Deno.test("[auditLedgerRows] a candidate identifier not defined anywhere is silently skipped, not flagged", () => {
  // Prose false positives (e.g. an acronym with an underscore) that never resolve to a
  // real export must not produce a finding — there is nothing to verify reachability of.
  const rows: IReachabilityLedgerRow[] = [{
    docPath: "phase-999-example.md",
    symbolLabel: "`some-row`",
    addedIn: "Step 1",
    wiringStep: "Step 2",
    callSiteText: "closed (CI_CORE profile used)",
    status: "✅",
  }];
  const files: IFileRecord[] = [
    { path: "packages/foo/src/bar.ts", content: "export function unrelatedThing() {}" },
  ];

  assertEquals(auditLedgerRows(rows, files), []);
});
