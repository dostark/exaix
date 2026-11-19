#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCheckPrereqs
 * @path scripts/go_port/check_prereqs.ts
 * @description Validates the Phase 245 owner prerequisites: budgets, both go-port refs and the live protection shape.
 * @architectural-layer Tooling
 * @dependencies [zod, @std/path]
 * @related-files [exaix-dev-docs/evidence/go-port/prerequisites.json, exaix-dev-docs/planning/phase-245-go-port-prerequisites.md]
 *
 * Usage:
 *   deno run -A scripts/go_port/check_prereqs.ts [--file=<path>] [--online]
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { z } from "zod";

/** The owner, budget and repository record that gates the port branch work. */
export interface IPrerequisites {
  readonly owner: string;
  readonly reviewers: { readonly capacity: string; readonly names: readonly string[] };
  readonly budget: { readonly hours: number; readonly spend_usd: number };
  readonly d24_rule: string;
  readonly w0a_budget: { readonly weeks: number };
  readonly repositories: {
    readonly exaix_go: string;
    readonly go_port: { readonly parent: string; readonly team: string };
  };
  readonly protection: {
    readonly parent: { readonly attestation: string; readonly evidence: string };
    readonly team: {
      readonly attestation: string;
      readonly reason: string;
      readonly approved_by: string;
      readonly date: string;
    };
  };
  readonly ci_approval: {
    readonly approved: boolean;
    readonly approver: string;
    readonly date: string;
    readonly evidence: string;
  };
}

/** The untrusted JSON shape validated by the schema. */
interface IPrerequisitesInput {
  readonly owner?: string;
  readonly reviewers?: { readonly capacity?: string; readonly names?: readonly string[] };
  readonly budget?: { readonly hours?: number; readonly spend_usd?: number };
  readonly d24_rule?: string;
  readonly w0a_budget?: { readonly weeks?: number };
  readonly repositories?: {
    readonly exaix_go?: string;
    readonly go_port?: { readonly parent?: string; readonly team?: string };
  };
  readonly protection?: {
    readonly parent?: { readonly attestation?: string; readonly evidence?: string };
    readonly team?: {
      readonly attestation?: string;
      readonly reason?: string;
      readonly approved_by?: string;
      readonly date?: string;
    };
  };
  readonly ci_approval?: {
    readonly approved?: boolean;
    readonly approver?: string;
    readonly date?: string;
    readonly evidence?: string;
  };
}

/** The branch roots used by the offline branch check. */
export interface IBranchRoots {
  readonly parent: string;
  readonly team: string;
}

/** The subset of a GitHub branch-protection response this check reads. */
interface IProtectionShape {
  readonly required_pull_request_reviews?: { readonly required_approving_review_count?: number } | null;
  readonly required_linear_history?: { readonly enabled?: boolean } | null;
}

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), "..", ".."));
const DEFAULT_EVIDENCE = join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "prerequisites.json");
const SHA = /^[0-9a-f]{7,40}$/;
const D24_RULE = "both";
const ATTESTED = "attested";

const PrerequisitesSchema = z.object({
  owner: z.string().min(1),
  reviewers: z.object({
    capacity: z.string().min(1),
    names: z.array(z.string().min(1)).min(1),
  }).strict(),
  budget: z.object({
    hours: z.number().int(),
    spend_usd: z.number(),
  }).strict(),
  d24_rule: z.string(),
  w0a_budget: z.object({ weeks: z.number() }).strict(),
  repositories: z.object({
    exaix_go: z.string().url(),
    go_port: z.object({
      parent: z.string().regex(SHA),
      team: z.string().regex(SHA),
    }).strict(),
  }).strict(),
  protection: z.object({
    parent: z.object({
      attestation: z.string(),
      evidence: z.string(),
    }).strict(),
    team: z.object({
      attestation: z.string(),
      reason: z.string(),
      approved_by: z.string(),
      date: z.string(),
    }).strict(),
  }).strict(),
  ci_approval: z.object({
    approved: z.boolean(),
    approver: z.string().min(1),
    date: z.string().min(1),
    evidence: z.string().min(1),
  }).strict(),
}).strict();

/** Parses the record, or throws one message for every schema issue. */
export function parsePrerequisites(raw: IPrerequisitesInput): IPrerequisites {
  const result = PrerequisitesSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`);
    throw new Error(`prerequisites: ${details.join("; ")}`);
  }
  return result.data;
}

/** Returns the semantic errors that a schema-valid record can still carry. */
export function validatePrerequisites(record: IPrerequisites): string[] {
  const errors: string[] = [];
  if (record.owner.trim() === "") errors.push("owner: must not be empty");
  if (record.reviewers.names.length === 0) errors.push("reviewers.names: at least one reviewer is required");
  if (record.budget.hours <= 0) errors.push("budget.hours: must be positive");
  if (record.budget.spend_usd <= 0) errors.push("budget.spend_usd: must be positive");
  if (record.d24_rule !== D24_RULE) errors.push('d24_rule: must be "both"');
  if (record.w0a_budget.weeks <= 0) errors.push("w0a_budget.weeks: must be positive");
  if (record.protection.parent.attestation !== ATTESTED) {
    errors.push("protection.parent: must be attested");
  }
  if (record.protection.parent.evidence.trim() === "") {
    errors.push("protection.parent.evidence: must not be empty");
  }
  if (record.protection.team.attestation !== "owner-exception") {
    errors.push('protection.team: must be "owner-exception"');
  }
  if (record.protection.team.reason.trim() === "") {
    errors.push("protection.team.reason: must not be empty");
  }
  if (record.protection.team.approved_by.trim() === "") {
    errors.push("protection.team.approved_by: must not be empty");
  }
  if (record.protection.team.date.trim() === "") errors.push("protection.team.date: must not be empty");
  if (!record.ci_approval.approved) errors.push("ci_approval: must be approved");
  if (record.ci_approval.approver.trim() === "") errors.push("ci_approval.approver: must not be empty");
  return errors;
}

/** Checks that both go-port refs exist. The callback is injectable for tests. */
export function checkBranches(
  _record: IPrerequisites,
  branchExists: (cwd: string) => boolean,
  roots: IBranchRoots = { parent: REPO_ROOT, team: join(REPO_ROOT, "exaix-team") },
): string[] {
  const errors: string[] = [];
  if (!branchExists(roots.parent)) errors.push(`parent: go-port is missing at ${roots.parent}`);
  if (!branchExists(roots.team)) errors.push(`team: go-port is missing at ${roots.team}`);
  return errors;
}

/** Reads the live protection object and returns its missing rules. */
export function validateProtectionShape(raw: IProtectionShape | null): string[] {
  const errors: string[] = [];
  if (raw?.required_pull_request_reviews === null || raw?.required_pull_request_reviews === undefined) {
    errors.push("required_pull_request_reviews: pull requests must be required");
  }
  if (raw?.required_linear_history?.enabled !== true) {
    errors.push("required_linear_history: linear history must be enabled");
  }
  return errors;
}

async function git(cwd: string, args: readonly string[]): Promise<boolean> {
  const result = await new Deno.Command("git", {
    args: ["-C", cwd, ...args],
    env: { LD_LIBRARY_PATH: "" },
    stdout: "null",
    stderr: "null",
  }).output();
  return result.success;
}

async function ghProtection(repo: string): Promise<string[]> {
  const result = await new Deno.Command("gh", {
    args: ["api", `repos/${repo}/branches/go-port/protection`],
    env: { LD_LIBRARY_PATH: "" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    return [`${repo}: gh api protection read failed: ${new TextDecoder().decode(result.stderr).trim()}`];
  }
  try {
    return validateProtectionShape(JSON.parse(new TextDecoder().decode(result.stdout)));
  } catch {
    return [`${repo}: gh api returned invalid protection JSON`];
  }
}

async function main(args: readonly string[]): Promise<number> {
  const fileArg = args.find((arg) => arg.startsWith("--file="));
  const path = fileArg === undefined ? DEFAULT_EVIDENCE : resolve(fileArg.slice("--file=".length));
  const online = args.includes("--online");
  let record: IPrerequisites;
  try {
    record = parsePrerequisites(JSON.parse(await Deno.readTextFile(path)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const errors = validatePrerequisites(record);
  const roots = { parent: REPO_ROOT, team: join(REPO_ROOT, "exaix-team") };
  for (const root of [roots.parent, roots.team]) {
    if (!await git(root, ["rev-parse", "--verify", "--quiet", "go-port"])) {
      errors.push(`${root}: go-port is missing`);
    } else if (!await git(root, ["merge-base", "--is-ancestor", "main", "go-port"])) {
      errors.push(`${root}: go-port is not descended from main`);
    }
  }
  if (online) {
    errors.push(...await ghProtection("dostark/exaix"));
    if (record.protection.team.attestation === ATTESTED) {
      errors.push(...await ghProtection("dostark/exaix-team"));
    }
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`❌ ${error}`);
    return 1;
  }
  console.log(
    `✅ prerequisites: ${record.owner} · ${record.budget.hours}h / $${record.budget.spend_usd} · go-port present`,
  );
  return 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
