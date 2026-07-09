#!/usr/bin/env -S deno run -A
/**
 * @module CheckCommitMsg
 * @path scripts/check_commit_msg.ts
 * @description Validates structured commit messages against Exaix guidelines.
 *
 * Usage:
 *   deno run -A scripts/check_commit_msg.ts <commit_msg_file>
 */

/** A reference to a plan doc + step, parsed from the commit's `plan:` field. */
export interface IPlanRef {
  docPath: string;
  step: number;
}

/**
 * The paths a plan step declares as its success-criteria source modules and
 * planned-test modules, the ledger tokens of any ⚠️ deferred items, plus any structural
 * errors found while parsing the step.
 */
export interface IPlanStepPaths {
  criteriaPaths: string[];
  testPaths: string[];
  /** `→ <token>` of each `⚠️ deferred` criterion/test (must have a Reachability Ledger row). */
  deferredTokens: string[];
  /**
   * The raw text of every ✅ / ⚠️ deferred item line in the step (trimmed). Used to verify
   * these lines actually appear as added lines in the plan doc's diff for this commit.
   */
  itemLines: string[];
  errors: string[];
}

/** Whether the parent's staged submodule pointer matches the submodule's plan-doc state. */
export type PlanSyncStatus = "in_sync" | "out_of_sync" | "unknown";

/** Result of cross-repo plan-step diff consistency validation (pure; git done by caller). */
export interface IPlanDiffResult {
  ok: boolean;
  errors: string[];
}

/**
 * Everything the pure validator needs to enforce plan-step traceability, resolved
 * by the CLI entry point (doc read + git diff done there, matching stays pure/testable).
 */
export interface IPlanValidation {
  criteriaPaths: string[];
  testPaths: string[];
  planErrors: string[];
  changedFiles: string[];
  /** Ledger tokens of the step's `⚠️ deferred` items (optional; default none). */
  deferredTokens?: string[];
  /** Symbols found in the plan doc's Reachability Ledger table (optional; default none). */
  ledgerSymbols?: string[];
  /**
   * Cross-repo diff/sync inputs (optional). When present, `validateCommitMsg` also runs
   * `validatePlanStepDiff`: every step item line must be an added line of the plan doc's
   * diff, and the submodule/parent must be in sync. Omit to skip the diff/sync facet
   * (e.g. in unit tests of the path/ledger facet alone).
   */
  itemLines?: string[];
  addedPlanLines?: string[];
  planSync?: PlanSyncStatus;
}

/** Standard conventional commit types. */
const VALID_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

const REQUIRED_FIELDS = ["what", "rationale", "tests", "who", "impact"];

/** Known valid models to prevent hallucinations (can be extended). */
const VALID_MODELS = [
  "Gemini",
  "Claude",
  "GPT",
  "Antigravity",
  "Ollama",
  "Llama",
  "DeepSeek",
];

/**
 * Extract the `plan:` field from a commit message, if present. The field references
 * the plan doc and step this commit implements, e.g.
 *   `plan: exaix-dev-docs/planning/phase-134.md#6`
 * The step suffix accepts `#6`, `#step-6`, or `#step 6` (case-insensitive).
 * Returns undefined when no `plan:` field is present (normal, non-plan commits).
 */
export function parsePlanField(text: string): IPlanRef | undefined {
  const match = text.match(/^plan:\s*(.+?)#\s*(?:step[-\s]*)?(\d+)\s*$/im);
  if (!match) return undefined;
  return { docPath: match[1].trim(), step: Number(match[2]) };
}

/**
 * Extract the source/test paths after a `→` on a plan bullet line. Paths MUST be
 * backtick-wrapped (`` `apps/x/foo.ts` ``) so plan docs stay clean under check:md-path,
 * which flags un-backticked real paths in prose. Returns the backticked paths plus
 * `hasBarePath` — true when a non-backticked path-like token (contains a `/`) appears
 * after the arrow, which the caller treats as an error.
 */
function extractArrowPaths(line: string): { paths: string[]; hasBarePath: boolean } {
  const arrowIdx = line.indexOf("→");
  if (arrowIdx === -1) return { paths: [], hasBarePath: false };
  const tail = line.slice(arrowIdx + 1);

  const paths: string[] = [];
  for (const m of tail.matchAll(/`([^`]+)`/g)) {
    const inner = m[1].trim();
    if (inner.length > 0) paths.push(inner);
  }

  // Detect an un-backticked path-like token: strip the backticked spans, then look for a
  // leftover token containing a slash.
  const withoutBackticked = tail.replace(/`[^`]+`/g, " ");
  const hasBarePath = withoutBackticked
    .split(/[,\s]+/)
    .some((t) => t.trim().includes("/"));

  return { paths, hasBarePath };
}

/**
 * Parse a single `### Step N:` section of a plan doc and collect the source paths
 * declared on **done** success criteria and **done** planned tests, both marked with a
 * leading `✅` (`- ✅ … → path`). Not-yet-done items (unchecked `- [ ]` criteria, or
 * bullets without a ✅) are intentionally ignored so partial-step commits are allowed.
 *
 * A ✅-marked criterion or test WITHOUT a `→ path` is a structural error (the whole point
 * of the convention is that a claimed item names where it is met).
 */
export function parsePlanStep(docText: string, step: number): IPlanStepPaths {
  const lines = docText.split("\n");
  const errors: string[] = [];
  const criteriaPaths = new Set<string>();
  const testPaths = new Set<string>();
  const deferredTokens = new Set<string>();
  const itemLines = new Set<string>();

  // Locate the step's line range: from its `### Step N:` header to the next `### `.
  const headerRe = new RegExp(`^###\\s+Step\\s+${step}\\b`, "i");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return {
      criteriaPaths: [],
      testPaths: [],
      deferredTokens: [],
      itemLines: [],
      errors: [`Step ${step} not found in plan doc.`],
    };
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^###\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }

  // Walk the section, tracking whether we're under Planned Tests or Success Criteria.
  type Section = "tests" | "criteria" | null;
  let section: Section = null;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (/^\*\*Planned Tests\*\*/i.test(line)) {
      section = "tests";
      continue;
    }
    if (/^\*\*Success Criteria\*\*/i.test(line)) {
      section = "criteria";
      continue;
    }
    // A new bold heading (e.g. **Architecture Notes**) ends the current list section.
    if (/^\*\*[^*]+\*\*/.test(line) && !/Planned Tests|Success Criteria/i.test(line)) {
      section = null;
      continue;
    }
    if (section === null) continue;

    // ⚠️ deferred criteria/tests (either section): must carry a `→ <ledger-token>` that a
    // Reachability Ledger row references. They are exempt from the changed-file check.
    const deferred = line.match(/^\s*-\s*⚠️\s*deferred\b\s*(.*)$/i);
    if (deferred) {
      itemLines.add(line.trim());
      const tokens = extractArrowTokens(line);
      if (tokens.length === 0) {
        errors.push(
          `Step ${step} deferred item "${truncateForError(deferred[1])}" has no → ledger token ` +
            `(a deferral must name the Reachability Ledger symbol it is tracked by).`,
        );
      }
      tokens.forEach((t) => deferredTokens.add(t));
      continue;
    }

    // No unimplemented escape hatch: a `- [ ]` (unchecked) criterion/test may not remain in
    // a step the commit claims. Every item must be ✅ (done) or ⚠️ deferred (ledger-tracked).
    const unchecked = line.match(/^\s*-\s*\[\s\]\s*(.*)$/);
    if (unchecked) {
      const kind = section === "tests" ? "planned test" : "criterion";
      errors.push(
        `Step ${step} ${kind} "${truncateForError(unchecked[1])}" is still unchecked "- [ ]" — ` +
          `every item must be ✅ (done, with → path) or ⚠️ deferred (with a Reachability Ledger row); ` +
          `unimplemented requirements cannot be left open in a committed step.`,
      );
      continue;
    }

    if (section === "criteria") {
      // Done criteria are marked with a leading ✅ (the completion mark, same as tests).
      const done = line.match(/^\s*-\s*✅\s*(.*)$/);
      if (done) {
        itemLines.add(line.trim());
        const { paths, hasBarePath } = extractArrowPaths(line);
        if (hasBarePath) {
          errors.push(
            `Step ${step} criterion "${truncateForError(done[1])}" has an un-backticked → source path — ` +
              `wrap paths in backticks (e.g. → \`apps/x/foo.ts\`) so the plan stays check:md-path-clean.`,
          );
        }
        if (paths.length === 0 && !hasBarePath) {
          errors.push(
            `Step ${step} criterion "${truncateForError(done[1])}" is marked ✅ but has no → source path.`,
          );
        }
        paths.forEach((p) => criteriaPaths.add(p));
      }
    } else if (section === "tests") {
      // Done tests are marked with a leading ✅ (optionally after "- ").
      const done = line.match(/^\s*-\s*✅\s*(.*)$/);
      if (done) {
        itemLines.add(line.trim());
        const { paths, hasBarePath } = extractArrowPaths(line);
        if (hasBarePath) {
          errors.push(
            `Step ${step} planned test "${truncateForError(done[1])}" has an un-backticked → test path — ` +
              `wrap paths in backticks (e.g. → \`apps/x/foo_test.ts\`) so the plan stays check:md-path-clean.`,
          );
        }
        if (paths.length === 0 && !hasBarePath) {
          errors.push(
            `Step ${step} planned test "${truncateForError(done[1])}" is done ✅ but has no → test path.`,
          );
        }
        paths.forEach((p) => testPaths.add(p));
      }
    }
  }

  return {
    criteriaPaths: [...criteriaPaths],
    testPaths: [...testPaths],
    deferredTokens: [...deferredTokens],
    itemLines: [...itemLines],
    errors,
  };
}

/**
 * Extract the `→ <token…>` tokens of a deferred line. Unlike source paths these need not
 * contain a slash (a ledger symbol like `IModelRegistryProvider` is a bare identifier),
 * so any non-empty whitespace/comma-separated token after the arrow is kept.
 */
function extractArrowTokens(line: string): string[] {
  const arrowIdx = line.indexOf("→");
  if (arrowIdx === -1) return [];
  return line
    .slice(arrowIdx + 1)
    .split(/[,\s]+/)
    .map((t) => t.replace(/`/g, "").trim())
    .filter((t) => t.length > 0);
}

/**
 * Extract the Symbol column (first cell, backtick-wrapped) of every data row in a
 * Reachability Ledger table. A ledger row is a `| … |` table line whose first cell is a
 * backtick-quoted symbol; header/separator rows and non-table lines are skipped.
 */
export function parseLedgerSymbols(docText: string): string[] {
  const symbols: string[] = [];
  for (const line of docText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const firstCell = trimmed.split("|")[1]?.trim() ?? "";
    const backticked = firstCell.match(/^`([^`]+)`$/);
    if (backticked) symbols.push(backticked[1].trim());
  }
  return symbols;
}

/** Trim a criterion/test label for a readable error message. */
function truncateForError(s: string): string {
  const clean = s.replace(/`/g, "").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
}

/**
 * Pure cross-repo consistency check for a plan-step commit. Verifies that every ✅ /
 * ⚠️ deferred item line of the claimed step appears among the plan doc's **added** diff
 * lines (proving this commit actually authored/changed them), and that the parent's
 * submodule pointer is in sync with the plan doc's state. Git plumbing (reading the
 * staged diffs + pointer) is done by the caller; this function is pure and testable.
 *
 * @param itemLines     Trimmed ✅ / deferred item lines parsed from the step.
 * @param addedDiffLines Trimmed added lines (`+` stripped) of the plan doc's diff.
 * @param sync          Whether the parent pointer matches the submodule plan-doc state.
 */
export function validatePlanStepDiff(
  itemLines: string[],
  addedDiffLines: string[],
  sync: PlanSyncStatus,
): IPlanDiffResult {
  const errors: string[] = [];

  if (sync === "out_of_sync") {
    errors.push(
      "Plan sync: the parent's staged submodule pointer does not match the plan doc's " +
        "committed state — roll back the submodule's last commit and re-stage the plan " +
        "changes together with the code so the phase file and the parent stay in sync.",
    );
  } else if (sync === "unknown") {
    errors.push(
      "Plan sync: could not resolve the plan doc's diff (submodule state unavailable) — " +
        "roll back the submodule's last commit and stage the plan changes alongside the " +
        "code, then retry so the check can verify the step.",
    );
  }

  // Every claimed step item line must be an added line of the plan doc's diff.
  const added = new Set(addedDiffLines.map((l) => l.trim()));
  for (const item of itemLines) {
    if (!added.has(item.trim())) {
      errors.push(
        `Plan diff: step item "${truncateForError(item)}" is not an added line in the ` +
          `plan doc's diff for this commit — a ✅/⚠️ deferred item must be marked in the ` +
          `same change that implements it (stale/pre-existing marks are not accepted).`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validates a commit message string.
 * @param text The full commit message.
 * @param options Validation options including changed file count for metrics.
 * @returns Object with success status and list of error messages.
 */
export function validateCommitMsg(
  text: string,
  options: {
    changedFileCount?: number;
    isMergeCommit?: boolean;
    planValidation?: IPlanValidation;
  } = {},
): { success: boolean; errors: string[] } {
  const errors: string[] = [];
  const lines = text.split("\n");

  if (options.isMergeCommit) {
    return { success: true, errors: [] };
  }

  if (lines.length === 0 || !lines[0].trim()) {
    return { success: false, errors: ["Commit message is empty."] };
  }

  const subject = lines[0].trim();

  // 1. Skip validation for auto-generated commits
  if (
    subject.startsWith("Merge branch") ||
    subject.startsWith("Merge remote-tracking branch") ||
    subject.startsWith("Revert ") ||
    subject.startsWith("fixup! ") ||
    subject.startsWith("squash! ")
  ) {
    return { success: true, errors: [] };
  }

  // 2. Validate Conventional Commit prefix
  const typeMatch = subject.match(/^(\w+)(?:\(.+\))?!?: /);
  if (!typeMatch) {
    errors.push(
      `Subject line does not follow conventional commit format: "<type>(<scope>): <summary>".`,
    );
  } else {
    const type = typeMatch[1];
    if (!VALID_TYPES.includes(type)) {
      errors.push(`Invalid commit type "${type}". Allowed types: ${VALID_TYPES.join(", ")}.`);
    }
  }

  // 3. Extract fields and validate
  const fieldMap = new Map<string, string>();
  let currentField: string | null = null;
  let currentContent: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const fieldMatch = line.match(/^(\w+):\s*(.*)/);

    if (fieldMatch) {
      if (currentField) {
        fieldMap.set(currentField, currentContent.join("\n").trim());
      }
      currentField = fieldMatch[1].toLowerCase();
      currentContent = [fieldMatch[2]];
    } else if (currentField) {
      currentContent.push(line);
    }
  }
  if (currentField) {
    fieldMap.set(currentField, currentContent.join("\n").trim());
  }

  for (const field of REQUIRED_FIELDS) {
    if (!fieldMap.has(field)) {
      errors.push(`Missing required field: "${field}:".`);
    } else if (!fieldMap.get(field)) {
      errors.push(`Required field "${field}:" cannot be empty.`);
    }
  }

  const what = fieldMap.get("what") || "";
  const rationale = fieldMap.get("rationale") || "";
  const impact = fieldMap.get("impact") || "";

  // 4. Specific Impact validation & Component Traceability
  if (impact) {
    // Requirement: <component>: <details>
    if (!impact.includes(":")) {
      errors.push(
        `Impact field must follow the format "<component>: <details>" (e.g., "ReqProc: added validation").`,
      );
    } else {
      // Component Traceability: Every component must appear in 'what'.
      // Multi-component entries are separated by semicolons:
      //   "CompA: details; CompB: more details"
      // Segments without a colon are plain continuation text, not component names.
      const components = impact
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.includes(":"))
        .map((s) => s.split(":")[0].trim());
      for (const comp of components) {
        if (comp && !what.toLowerCase().includes(comp.toLowerCase())) {
          errors.push(
            `Component Traceability failed: Component "${comp}" mentioned in impact but missing from the "what:" explanation.`,
          );
        }
      }
    }
  }

  // 5. Model validation (hallucination check)
  if (fieldMap.has("model")) {
    const model = fieldMap.get("model")!;
    const isKnown = VALID_MODELS.some((m) => model.toLowerCase().includes(m.toLowerCase()));
    if (!isKnown && model.trim() !== "") {
      errors.push(
        `Model "${model}" appears to be hallucinated or unknown. Use a real model name (e.g., Gemini, Claude, Antigravity).`,
      );
    }
  }

  // 6. Metrics: Structural Bloom
  const changedFileCount = options.changedFileCount || 0;
  if (changedFileCount > 3) {
    // Count bullet points starting with - or * followed by a space
    const bulletRegex = /^[ \t]*[-*] /gm;
    const bullets = (what.match(bulletRegex) || []).length;
    if (bullets < 2) {
      errors.push(
        `Structural Bloom: Changes affect ${changedFileCount} files. Please use at least two bullet points in the "what:" section to break down the changes.`,
      );
    }
  }

  // 7. Metrics: Density Threshold
  const combined = (what + " " + rationale).trim();
  const words = combined.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  // Threshold: 5 words per file, capped at 50
  const requiredWords = Math.min(50, changedFileCount * 5);
  if (wordCount < requiredWords) {
    errors.push(
      `Density Threshold: Your description is only ${wordCount} words. Based on ${changedFileCount} files changed, at least ${requiredWords} words of detail (across what/rationale) are required.`,
    );
  }

  // 8. Plan-step traceability (only when a `plan:` field resolved to a step).
  //    Every checked success criterion and every done planned test in the referenced
  //    step must name a source/test module, and that module must be a changed file of
  //    THIS commit — otherwise the item is claimed without proof and the commit is blocked.
  if (options.planValidation) {
    const pv = options.planValidation;
    // Surface any structural errors from parsing the plan step verbatim.
    for (const e of pv.planErrors) errors.push(`Plan traceability: ${e}`);

    const changed = new Set(pv.changedFiles);
    for (const path of pv.criteriaPaths) {
      if (!changed.has(path)) {
        errors.push(
          `Plan traceability: success-criterion module "${path}" is not among this commit's changed files — ` +
            `either it is not actually implemented here or the criterion is unfairly marked done.`,
        );
      }
    }
    for (const path of pv.testPaths) {
      if (!changed.has(path)) {
        errors.push(
          `Plan traceability: planned-test module "${path}" is not among this commit's changed files — ` +
            `the test is marked done ✅ but its file was not committed.`,
        );
      }
    }
    // Deferred items are exempt from the changed-file check (intentionally not done here)
    // but MUST be tracked by a Reachability Ledger row naming the same token.
    const ledger = new Set(pv.ledgerSymbols ?? []);
    for (const token of pv.deferredTokens ?? []) {
      if (!ledger.has(token)) {
        errors.push(
          `Plan traceability: deferred item "${token}" has no matching Reachability Ledger row — ` +
            `a ⚠️ deferred criterion/test must be tracked by a ledger entry naming that symbol.`,
        );
      }
    }

    // Cross-repo diff/sync facet (only when the caller supplied the plan-doc diff inputs):
    // every step item line must be an added line of the plan doc's diff, and the
    // submodule/parent pointer must be in sync.
    if (pv.itemLines !== undefined && pv.addedPlanLines !== undefined && pv.planSync !== undefined) {
      const diff = validatePlanStepDiff(pv.itemLines, pv.addedPlanLines, pv.planSync);
      errors.push(...diff.errors);
    }
  }

  return { success: errors.length === 0, errors };
}

/** The staged (`--cached`) changed-file paths, repo-root-relative, or [] on failure. */
async function getStagedFiles(): Promise<string[]> {
  try {
    const output = await new Deno.Command("git", {
      args: ["diff", "--cached", "--name-only"],
      stdout: "piped",
      stderr: "null",
    }).output();
    const text = new TextDecoder().decode(output.stdout).trim();
    return text ? text.split("\n").map((f) => f.trim()).filter((f) => f.length > 0) : [];
  } catch (_e) {
    return [];
  }
}

/** Run git in `cwd` (or the repo root); trimmed stdout, or "" on failure. */
async function gitOut(args: string[], cwd?: string): Promise<string> {
  try {
    const out = await new Deno.Command("git", {
      args: cwd ? ["-C", cwd, ...args] : args,
      stdout: "piped",
      stderr: "null",
    }).output();
    return out.success ? new TextDecoder().decode(out.stdout).trim() : "";
  } catch (_e) {
    return "";
  }
}

/** The configured submodule paths (from .gitmodules), longest-first for prefix matching. */
async function submodulePaths(): Promise<string[]> {
  const raw = await gitOut(["config", "--file", ".gitmodules", "--get-regexp", "path"]);
  return raw
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[1])
    .filter((p): p is string => Boolean(p))
    .sort((a, b) => b.length - a.length);
}

/** Owning repo of a plan-doc path: the submodule dir + in-submodule path, or the parent. */
export interface IOwningRepo {
  submodule?: string;
  relPath: string;
}

export async function resolveOwningRepo(docPath: string): Promise<IOwningRepo> {
  for (const sub of await submodulePaths()) {
    if (docPath === sub || docPath.startsWith(`${sub}/`)) {
      return { submodule: sub, relPath: docPath.slice(sub.length).replace(/^\//, "") };
    }
  }
  return { relPath: docPath };
}

/** Added lines (`+` stripped, trimmed) of a diff `range` for `relPath` in the owning repo. */
async function addedLinesFor(repo: IOwningRepo, range: string[]): Promise<string[]> {
  const diff = await gitOut(["diff", ...range, "--unified=0", "--", repo.relPath], repo.submodule);
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length > 0);
}

/**
 * Added plan-doc lines this commit contributes = the STAGED diff UNION the last commit's
 * diff (HEAD~1..HEAD). The union covers both flows: (a) plan doc staged together with the
 * code (this hook fires before the commit — staged shows the lines), and (b) the
 * submodule was committed first by `commit_plan_step.ts` (its lines are in HEAD~1..HEAD).
 */
async function planAddedLines(repo: IOwningRepo): Promise<string[]> {
  const staged = await addedLinesFor(repo, ["--cached"]);
  const lastCommit = await addedLinesFor(repo, ["HEAD~1", "HEAD"]);
  return [...new Set([...staged, ...lastCommit])];
}

/**
 * Sync status of the plan doc's owning repo. `unknown` when a submodule is unresolvable
 * (not checked out / no HEAD); `out_of_sync` when neither the staged nor the last-commit
 * diff carries any plan-doc change (nothing to prove this step was authored here);
 * otherwise `in_sync`.
 */
async function planSyncStatus(repo: IOwningRepo, addedLines: string[]): Promise<PlanSyncStatus> {
  if (repo.submodule) {
    const head = await gitOut(["rev-parse", "HEAD"], repo.submodule);
    if (!head) return "unknown";
  }
  return addedLines.length > 0 ? "in_sync" : "out_of_sync";
}

/**
 * Resolve the plan-step validation payload for a commit whose `plan:` field names a
 * doc + step. Reads the plan doc, extracts the step's source/test paths + item lines, the
 * ledger symbols, and the plan-doc diff/sync (staged ∪ last-commit) so `validateCommitMsg`
 * enforces the full plan-step gate — including cross-repo consistency — from the hook.
 * A doc-read failure blocks the commit rather than silently passing.
 */
async function resolvePlanValidation(planRef: IPlanRef, stagedFiles: string[]): Promise<IPlanValidation> {
  let docText: string;
  try {
    docText = Deno.readTextFileSync(planRef.docPath);
  } catch (_e) {
    return {
      criteriaPaths: [],
      testPaths: [],
      planErrors: [
        `plan doc "${planRef.docPath}" (from the plan: field) could not be read — ` +
        `check the path is repo-root-relative and committed.`,
      ],
      changedFiles: stagedFiles,
    };
  }
  const parsed = parsePlanStep(docText, planRef.step);
  const repo = await resolveOwningRepo(planRef.docPath);
  const addedPlanLines = await planAddedLines(repo);
  const planSync = await planSyncStatus(repo, addedPlanLines);
  return {
    criteriaPaths: parsed.criteriaPaths,
    testPaths: parsed.testPaths,
    planErrors: parsed.errors,
    changedFiles: stagedFiles,
    deferredTokens: parsed.deferredTokens,
    ledgerSymbols: parseLedgerSymbols(docText),
    itemLines: parsed.itemLines,
    addedPlanLines,
    planSync,
  };
}

async function isGitMergeCommit(): Promise<boolean> {
  try {
    const process = new Deno.Command("git", {
      args: ["rev-parse", "--verify", "MERGE_HEAD"],
      stdout: "null",
      stderr: "null",
    });
    const { code } = await process.output();
    return code === 0;
  } catch (_e) {
    return false;
  }
}

/** CLI Entry point */
if (import.meta.main) {
  const commitMsgFile = Deno.args[0];
  if (!commitMsgFile) {
    console.error("Usage: deno run scripts/check_commit_msg.ts <commit-msg-file>");
    Deno.exit(1);
  }

  try {
    const text = Deno.readTextFileSync(commitMsgFile);

    const stagedFiles = await getStagedFiles();
    const changedFileCount = stagedFiles.length;

    // Plan-step traceability: only engaged when the commit carries a `plan:` field.
    const planRef = parsePlanField(text);
    const planValidation = planRef ? await resolvePlanValidation(planRef, stagedFiles) : undefined;

    const mergeCommit = await isGitMergeCommit();
    const { success, errors } = validateCommitMsg(text, {
      changedFileCount,
      isMergeCommit: mergeCommit,
      planValidation,
    });

    if (!success) {
      console.error("\n❌ Structured Commit Message Validation Failed:");
      errors.forEach((e) => console.error(`  - ${e}`));
      console.error("\nExpected format:");
      console.error("  feat: subject line\n");
      console.error("  what: detailed explanation");
      console.error("  rationale: why this change");
      console.error("  tests: summary status");
      console.error("  who: agent or user name");
      console.error("  impact: ArchitectureComponent: brief details");
      console.error(
        "\nOptional: conversation_id, links, prompt, tool_audit, model, " +
          "plan (e.g. plan: path/to/phase.md#6 — enforces plan-step criterion/test traceability)\n",
      );
      Deno.exit(1);
    }

    console.log("✅ Commit message structure valid.");
    Deno.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error processing commit message: ${msg}`);
    Deno.exit(1);
  }
}
