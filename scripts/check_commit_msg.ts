#!/usr/bin/env -S deno run -A
/**
 * @module CheckCommitMsg
 * @path scripts/check_commit_msg.ts
 * @description Validates structured commit messages against Exaix guidelines.
 *
 * Usage:
 *   deno run -A scripts/check_commit_msg.ts <commit_msg_file>
 */

import type { Opt, Reason } from "@exaix/core/types";

/** A reference to a plan doc + step, parsed from the commit's `plan:` field. */
export interface IPlanRef {
  docPath: string;
  step: number;
}

interface IPlanStepPaths {
  criteriaPaths: string[];
  testPaths: string[];
  /** `→ <token>` of each `⚠️ deferred` criterion/test (must have a Reachability Ledger row). */
  deferredTokens: string[];
  /** Every ✅/⚠️ deferred item line (trimmed) — one entry per physical line, since a
   *  soft-wrapped bullet spans several; this matches git diff's per-physical-line output. */
  itemLines: string[];
  errors: string[];
}

/** Whether the parent's staged submodule pointer matches the submodule's plan-doc state. */
type PlanSyncStatus = "in_sync" | "out_of_sync" | "unknown";

/** Result of cross-repo plan-step diff consistency validation (pure; git done by caller). */
interface IPlanDiffResult {
  ok: boolean;
  errors: string[];
}

/** Inputs the pure validator needs for plan-step traceability; doc reads and git diffs
 *  are resolved by the CLI entry point so this stays pure and testable. */
interface IPlanValidation {
  criteriaPaths: string[];
  testPaths: string[];
  planErrors: string[];
  changedFiles: string[];
  /** Staged files of the plan's code submodules, by repository-relative path.
   *  It is optional and defaults to none.
   *  A paid-edition step keeps its source in a submodule. */
  submoduleStagedFiles?: string[];
  /** Ledger tokens of the step's `⚠️ deferred` items (optional; default none). */
  deferredTokens?: string[];
  /** Symbols found in the plan doc's Reachability Ledger table (optional; default none). */
  ledgerSymbols?: string[];
  /** Cross-repo diff/sync inputs (optional): when present, `validateCommitMsg` also verifies
   *  every step item line is an added plan-doc diff line and submodule/parent are in sync. */
  itemLines?: string[];
  addedPlanLines?: string[];
  planSync?: PlanSyncStatus;
}

/** Owning repo of a plan-doc path: the submodule dir + in-submodule path, or the parent. */
export interface IOwningRepo {
  submodule?: string;
  relPath: string;
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

/** Field names `validateCommitMsg`'s per-line parser treats as starting a new field; a
 *  `word:` line whose word is not here is a continuation of the current field (so prose
 *  like "check:style clean." inside a field body isn't misparsed as a phantom field). */
const KNOWN_COMMIT_FIELDS = new Set([
  ...REQUIRED_FIELDS,
  "model",
  "plan",
  "conversation_id",
  "links",
  "prompt",
  "tool_audit",
]);

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

/** Extracts the `plan:` field (e.g. `plan: docs/plan.md#6`) naming the plan doc + step this
 *  commit implements; accepts `#<n>`, `#step-<n>`, or `#step <n>` (case-insensitive). Returns
 *  undefined when absent. */
export function parsePlanField(text: string): IPlanRef | undefined {
  const match = text.match(/^plan:\s*(.+?)#\s*(?:step[-\s]*)?(\d+)\s*$/im);
  if (!match) return undefined;
  return { docPath: match[1].trim(), step: Number(match[2]) };
}

/** Extracts backtick-wrapped paths after `→` on a plan bullet (required so plan docs stay
 *  check:md-path-clean); `hasBarePath` flags a non-backticked path-like token after the arrow. */
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

/** True when `line` starts a new bullet (`- …`), a bold heading (`**…**`), or is blank —
 *  i.e. not a soft-wrapped continuation of the previous bullet. */
function startsNewPlanItem(line: string): boolean {
  return /^\s*-\s/.test(line) || /^\s*\*\*[^*]+\*\*/.test(line) || /^\s*$/.test(line);
}

/** Joins `lines[startIdx]` with its soft-wrapped continuation lines (up to `end`) into one
 *  string, so a `→ \`path\`` arrow on a continuation line is still found by `parsePlanStep`.
 *  Returns the merged text plus `endIndex`, the last physical line consumed. */
function joinWrappedBullet(
  lines: string[],
  startIdx: number,
  end: number,
): { text: string; endIndex: number } {
  let text = lines[startIdx].trim();
  let endIndex = startIdx;
  for (let j = startIdx + 1; j < end; j++) {
    if (startsNewPlanItem(lines[j])) break;
    text += ` ${lines[j].trim()}`;
    endIndex = j;
  }
  return { text, endIndex };
}

/** Parses a `### Step N:` section, collecting source paths from **done** (`✅`) success
 *  criteria and planned tests (`- ✅ … → path`); unchecked items are ignored so partial-step
 *  commits are allowed. A ✅ item without `→ path` is a structural error. */
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
  // Stop at the next step (`### `) OR next phase-level section (`## `) — without the latter,
  // the last step in a doc has no `### ` to bound it, sweeping later phase-level `- [ ]`
  // items (e.g. intentionally-unchecked Success Metrics) into this step's criteria/tests.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,3}\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }

  // Walk the section, tracking whether we're under Planned Tests or Success Criteria.
  type Section = "tests" | "criteria" | null;
  let section: Section = null;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (/^\s*-?\s*\*\*Planned Tests:?\*\*/i.test(line)) {
      section = "tests";
      continue;
    }
    if (/^\s*-?\s*\*\*Success Criteria:?\*\*/i.test(line)) {
      section = "criteria";
      continue;
    }
    // A new bold heading (e.g. **Architecture Notes**, or its bulleted form
    // `- **Architecture Notes**:`) ends the current list section.
    if (/^\s*-?\s*\*\*[^*]+\*\*/.test(line) && !/Planned Tests|Success Criteria/i.test(line)) {
      section = null;
      continue;
    }
    if (section === null) continue;
    // Only a `- …` line starts a new item; blank lines and stray prose are not bullets.
    if (!/^\s*-\s/.test(line)) continue;

    // Join wrapped continuation lines into one string for matching (so a `→ \`path\`` arrow
    // on a continuation line is found), but record each physical line in `itemLines`
    // individually to match git diff's per-physical-line added-lines output.
    const { text: joined, endIndex } = joinWrappedBullet(lines, i, end);
    const physicalLines = lines.slice(i, endIndex + 1).map((l) => l.trim());
    i = endIndex;

    // ⚠️ deferred criteria/tests (either section): must carry a `→ <ledger-token>` that a
    // Reachability Ledger row references. They are exempt from the changed-file check.
    const deferred = joined.match(/^\s*-\s*⚠️\s*deferred\b\s*(.*)$/i);
    if (deferred) {
      physicalLines.forEach((l) => itemLines.add(l));
      const tokens = extractArrowTokens(joined);
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
    const unchecked = joined.match(/^\s*-\s*\[\s\]\s*(.*)$/);
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
      const done = joined.match(/^\s*-\s*✅\s*(.*)$/);
      if (done) {
        physicalLines.forEach((l) => itemLines.add(l));
        const { paths, hasBarePath } = extractArrowPaths(joined);
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
      const done = joined.match(/^\s*-\s*✅\s*(.*)$/);
      if (done) {
        physicalLines.forEach((l) => itemLines.add(l));
        const { paths, hasBarePath } = extractArrowPaths(joined);
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

/** Extracts `→ <token>` tokens of a deferred line; unlike source paths these need not
 *  contain a slash (a ledger symbol is a bare identifier), so any non-empty token is kept. */
function extractArrowTokens(line: string): string[] {
  const arrowIdx = line.indexOf("→");
  if (arrowIdx === -1) return [];
  return line
    .slice(arrowIdx + 1)
    .split(/[,\s]+/)
    .map((t) => t.replace(/`/g, "").trim())
    .filter((t) => t.length > 0);
}

/** Extracts the Symbol column (first cell, backtick-wrapped) of every data row in a Reachability Ledger table.
 *  Header rows, separator rows and non-table lines are skipped. */
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

/** Pure cross-repo consistency check for a plan-step commit. Every ✅ or deferred item line must appear in the plan doc's added diff lines.
 *  The parent's submodule pointer must match the plan doc's state. The caller reads the git data.
 *  The sync flag says whether that pointer matches. */
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

/** Validates a commit message string. The text argument is the full commit message.
 *  The options argument carries validation options, including the changed file count.
 *  The result holds a success status and the list of error messages. */
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
    subject.startsWith("Merge pull request") ||
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

    if (fieldMatch && KNOWN_COMMIT_FIELDS.has(fieldMatch[1].toLowerCase())) {
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
      // Component traceability: every component must appear in 'what'. A multi-component entry is split by semicolons ("CompA: details; CompB: more").
      // A segment without a colon is plain continuation text, not a component name.
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

  // Plan-step traceability runs only when a `plan:` field resolved to a step.
  // Every checked criterion and done planned test must name a source or test module.
  // That module must be a changed file of this commit, or the item is claimed without proof.
  if (options.planValidation) {
    const pv = options.planValidation;
    // Surface any structural errors from parsing the plan step verbatim.
    for (const e of pv.planErrors) errors.push(`Plan traceability: ${e}`);

    const changed = new Set([...pv.changedFiles, ...(pv.submoduleStagedFiles ?? [])]);
    /** A plan path may carry its submodule prefix (`exaix-team/x`), while the
     *  submodule reports `x`. Accept either form. */
    const isChanged = (path: string): boolean => {
      if (changed.has(path)) return true;
      for (const sub of PLAN_CODE_SUBMODULES) {
        if (path.startsWith(`${sub}/`) && changed.has(path.slice(sub.length + 1))) return true;
      }
      return false;
    };
    for (const path of pv.criteriaPaths) {
      if (!isChanged(path)) {
        errors.push(
          `Plan traceability: success-criterion module "${path}" is not among this commit's changed files — ` +
            `either it is not actually implemented here or the criterion is unfairly marked done.`,
        );
      }
    }
    for (const path of pv.testPaths) {
      if (!isChanged(path)) {
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
/** Submodules whose committed files a phase plan may reference.
 *  The path is repository-relative, for example `exaix-team/packages/x/src/y.ts`. */
const PLAN_CODE_SUBMODULES = ["exaix-team", "exaix-enterprise"];

/** Changed files of every code submodule the parent is committing. A paid-edition plan step keeps its source in a submodule, and those paths must pass the arrow-path check too.
 *  A staged diff comes first, then the submodule's last commit, because the pointer in this commit ships that committed work. */
async function getSubmoduleStagedFiles(submodulePaths: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const sub of submodulePaths) {
    const staged = await gitNameOnly(["diff", "--cached", "--name-only"], sub);
    const head = staged.length > 0 ? staged : await gitNameOnly(["show", "--name-only", "--format=", "HEAD"], sub);
    files.push(...head);
  }
  return files;
}

/** Reads newline-separated paths from one git command in `sub`. */
async function gitNameOnly(args: string[], sub: string): Promise<string[]> {
  try {
    const output = await new Deno.Command("git", {
      args: ["-C", sub, ...args],
      env: { LD_LIBRARY_PATH: "" },
      stdout: "piped",
      stderr: "null",
    }).output();
    const text = new TextDecoder().decode(output.stdout).trim();
    return text ? text.split("\n").map((f) => f.trim()).filter((f) => f.length > 0) : [];
  } catch (_e) {
    // An uninitialized submodule cannot contribute files.
    return [];
  }
}

async function getStagedFiles(): Promise<string[]> {
  try {
    const output = await new Deno.Command("git", {
      args: ["diff", "--cached", "--name-only"],
      // See scripts/check_edition_graph.ts for why LD_LIBRARY_PATH is scrubbed here.
      env: { LD_LIBRARY_PATH: "" },
      stdout: "piped",
      stderr: "null",
    }).output();
    const text = new TextDecoder().decode(output.stdout).trim();
    return text ? text.split("\n").map((f) => f.trim()).filter((f) => f.length > 0) : [];
  } catch (_e) {
    return [];
  }
}

/** Env var names that git sets for every hook subprocess: GIT_DIR, GIT_INDEX_FILE and GIT_PREFIX. They point at the parent repo.
 *  If inherited, a nested `git -C <submodule>` call resolves against the parent repo. It then reports an empty diff.
 *  Deno.Command's `env` only merges overrides. Git treats GIT_DIR as an invalid empty path, so the keys must be deleted first. */
const GIT_HOOK_ENV_VARS = [
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_WORK_TREE",
  "GIT_PREFIX",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
] as const;

/** Runs git in `cwd` (or the repo root) and returns trimmed stdout, or "" on failure.
 *  It deletes git's hook-context env vars before every spawn. A cross-repo `-C <submodule>` call then resolves from its own cwd.
 *  Deleting an absent key is a no-op. A missing `--allow-env` grant degrades to a no-op. */
export async function gitOut(args: string[], cwd?: Opt<string, Reason.OptionalContext>): Promise<string> {
  for (const name of GIT_HOOK_ENV_VARS) {
    try {
      Deno.env.delete(name);
    } catch {
      // Permission not granted for this specific key — best effort, see doc comment above.
    }
  }
  try {
    const out = await new Deno.Command("git", {
      args: cwd ? ["-C", cwd, ...args] : args,
      // See scripts/check_edition_graph.ts for why LD_LIBRARY_PATH is scrubbed here.
      env: { LD_LIBRARY_PATH: "" },
      stdout: "piped",
      stderr: "null",
    }).output();
    return out.success ? new TextDecoder().decode(out.stdout).trim() : "";
  } catch {
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

/** Added plan-doc lines this commit contributes: the staged diff plus the last commit's diff (HEAD~1..HEAD).
 *  The union covers a plan doc staged with the code and a submodule that `commit_plan_step.ts` committed first. */
async function planAddedLines(repo: IOwningRepo): Promise<string[]> {
  const staged = await addedLinesFor(repo, ["--cached"]);
  const lastCommit = await addedLinesFor(repo, ["HEAD~1", "HEAD"]);
  return [...new Set([...staged, ...lastCommit])];
}

/** Sync status of the plan doc's owning repo. `unknown` means a submodule is unresolvable, not checked out or without HEAD.
 *  The `out_of_sync` status means neither the staged nor the last-commit diff changes the plan doc. Otherwise the status is `in_sync`. */
async function planSyncStatus(repo: IOwningRepo, addedLines: string[]): Promise<PlanSyncStatus> {
  if (repo.submodule) {
    const head = await gitOut(["rev-parse", "HEAD"], repo.submodule);
    if (!head) return "unknown";
  }
  return addedLines.length > 0 ? "in_sync" : "out_of_sync";
}

/** Resolves the plan-step validation payload for a commit whose `plan:` field names a doc and step.
 *  It reads the doc, the step's source and test paths, the item lines and the ledger symbols. It also reads the plan-doc diff and sync.
 *  `validateCommitMsg` enforces the full gate from the hook. A doc-read failure blocks the commit. */
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

export async function isGitMergeCommit(cwd?: Opt<string, Reason.OptionalContext>): Promise<boolean> {
  // MERGE_HEAD exists only during a live merge. Git deletes it when the merge commit lands.
  // An already-committed merge commit, such as CI's Gate 0 on a fresh checkout, never sees it.
  // A merge commit is identifiable by having two or more parents on HEAD. Both checks go through `gitOut`, which resolves against `cwd` or `-C`, not an inherited GIT_DIR.
  const mergeHead = await gitOut(["rev-parse", "--verify", "MERGE_HEAD"], cwd);
  if (mergeHead) {
    return true;
  }
  const secondParent = await gitOut(["rev-parse", "--verify", "HEAD^2"], cwd);
  return secondParent.length > 0;
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
    if (planValidation) {
      // A paid-edition step keeps its source in a submodule, so include those
      // staged files in the plan's arrow-path check.
      planValidation.submoduleStagedFiles = await getSubmoduleStagedFiles(PLAN_CODE_SUBMODULES);
    }

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
