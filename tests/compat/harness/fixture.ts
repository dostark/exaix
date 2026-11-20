/**
 * @module CompatFixture
 * @path tests/compat/harness/fixture.ts
 * @description Generates the pending-review workspace fixture with the frozen TS binaries and archives it.
 */

import { Database } from "@db/sqlite";
import { encodeHex } from "@std/encoding/hex";
import { join, relative, resolve } from "@std/path";
import { COMPAT_LEAK_SCAN_MAX_FILE_BYTES } from "./compat_constants.ts";
import { COMPAT_SCHEMA_VERSION } from "./compat_types.ts";
import type { ICandidateBinding } from "./compat_types.ts";
import { materializeWritableTrees, SANDBOX_TREE_ROOT } from "./sandbox.ts";
import { runSession } from "./session.ts";
import { createCopyResolver } from "./workspace_paths.ts";

export interface IPlanWrite {
  path: string;
  content: string;
}

export interface IPlanSpec {
  kind: FixtureReviewKind;
  traceId: string;
  requestId: string;
  agentRole: string;
  portal: string;
  targetBranch: string | null;
  write: IPlanWrite | null;
}

export interface IFixtureReview {
  kind: FixtureReviewKind;
  /** The identifier an operator passes to `exactl review`. */
  reviewRef: string;
  requestId: string;
  traceId: string;
  portal: string;
  branch: string | null;
  baseBranch: string | null;
  worktreePath: string | null;
  provenance: string;
}

export interface IArtifactProbe {
  status: "created" | "no-recipe";
  detail: string;
}

export interface IFixtureManifest {
  schemaVersion: typeof COMPAT_SCHEMA_VERSION;
  archiveFile: string;
  archiveSha256: string;
  archiveBytes: number;
  binding: string;
  /** Journal rows with a greater rowid were written after the fixture was built. */
  journalBaselineRowid: number;
  reviews: IFixtureReview[];
  artifactProbe: IArtifactProbe;
  findings: string[];
}

export interface IArchiveInfo {
  bytes: number;
  sha256: string;
}

export interface ILeak {
  file: string;
  reason: string;
}

interface IReviewRow {
  trace_id: string;
  branch: string;
  base_branch: string | null;
  worktree_path: string | null;
}

interface IArtifactRow {
  id: string;
  request_id: string;
}

interface IMaxRow {
  max_rowid: number | null;
}

interface IPortalSpec {
  alias: string;
  strategy: "worktree" | "branch";
  /** Shell lines that run in the seeded repository after `release_1.2` exists. */
  extra: string;
}

export const FixtureReviewKind = {
  WORKTREE_CODE: "worktree-code",
  BRANCH_CONFIG_CODE: "branch-config-code",
  CONFLICT_CODE: "conflict-code",
  ARTIFACT: "artifact",
} as const;
export type FixtureReviewKind = typeof FixtureReviewKind[keyof typeof FixtureReviewKind];

export const FIXTURE_DIR = "exaix-dev-docs/evidence/go-port/pending_review";
export const FIXTURE_ARCHIVE_PATH = `${FIXTURE_DIR}/fixture.tar`;
export const FIXTURE_MANIFEST_PATH = `${FIXTURE_DIR}/fixture_manifest.json`;

const SEED_DATE = "2026-01-01T00:00:00Z";
const PLAN_CREATED_AT = "2026-01-01T00:00:00.000Z";
const BASE_BRANCH = "release_1.2";
const LOG_WAIT_TIMEOUT_SECONDS = 120;
const COMMAND_SEPARATOR_LENGTH = 2;
const SECRET_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /[A-Z0-9_]*API_KEY\s*[=:]\s*["']?[A-Za-z0-9_-]{12,}/, reason: "credential assignment" },
  { pattern: /sk-[A-Za-z0-9]{20,}/, reason: "secret key" },
];
const CONFLICT_FILE = "src/conflict.ts";
const REQUEST_FILE_FINDING =
  "The fixture injects plans without request files, so review show finds no matching file in Workspace/Requests and prints a warning with a stack trace on stderr.";

export const FIXTURE_PLANS: IPlanSpec[] = [
  {
    kind: FixtureReviewKind.WORKTREE_CODE,
    traceId: "a1000001-0000-4000-8000-000000000001",
    requestId: "request-a1000001",
    agentRole: "senior-coder",
    portal: "worktree-app",
    targetBranch: BASE_BRANCH,
    write: { path: "src/worktree_hello.ts", content: 'export const hello = "hello-worktree";\n' },
  },
  {
    kind: FixtureReviewKind.BRANCH_CONFIG_CODE,
    traceId: "a1000002-0000-4000-8000-000000000002",
    requestId: "request-a1000002",
    agentRole: "senior-coder",
    portal: "branch-app",
    targetBranch: "main",
    write: { path: "src/branch_hello.ts", content: 'export const hello = "hello-branch";\n' },
  },
  {
    kind: FixtureReviewKind.CONFLICT_CODE,
    traceId: "a1000003-0000-4000-8000-000000000003",
    requestId: "request-a1000003",
    agentRole: "senior-coder",
    portal: "conflict-app",
    targetBranch: BASE_BRANCH,
    write: { path: CONFLICT_FILE, content: 'export const conflict = "feature";\n' },
  },
  {
    kind: FixtureReviewKind.ARTIFACT,
    traceId: "a1000004-0000-4000-8000-000000000004",
    requestId: "request-a1000004",
    agentRole: "code-analyst",
    portal: "worktree-app",
    targetBranch: null,
    write: null,
  },
];

const PORTALS: IPortalSpec[] = [
  { alias: "worktree-app", strategy: "worktree", extra: "" },
  { alias: "branch-app", strategy: "branch", extra: "" },
  {
    alias: "conflict-app",
    strategy: "worktree",
    extra: [
      `git checkout -q ${BASE_BRANCH}`,
      `echo 'export const conflict = "base";' > ${CONFLICT_FILE}`,
      "git add -A",
      `GIT_AUTHOR_DATE=${SEED_DATE} GIT_COMMITTER_DATE=${SEED_DATE} git commit -q -m "Seed conflict base"`,
      "git checkout -q main",
    ].join("\n"),
  },
];

/** Renders an approved plan in the format that the daemon's Active-plans watcher executes. */
export function renderPlan(spec: IPlanSpec): string {
  const header = [
    "---",
    `trace_id: "${spec.traceId}"`,
    `request_id: "${spec.requestId}"`,
    `agent_role: ${spec.agentRole}`,
    "status: approved",
    `created_at: "${PLAN_CREATED_AT}"`,
    `portal: "${spec.portal}"`,
    spec.targetBranch === null ? null : `target_branch: "${spec.targetBranch}"`,
    "---",
    "",
  ].filter((line) => line !== null);
  const body = spec.write === null ? ["# Analysis plan", "", "Analyse the portal and report.", ""] : [
    "```toml",
    'tool = "write_file"',
    'description = "write a file"',
    "",
    "[params]",
    `path = ${JSON.stringify(spec.write.path)}`,
    `content = ${JSON.stringify(spec.write.content)}`,
    "```",
    "",
  ];
  return [...header, ...body].join("\n");
}

export async function sha256File(path: string): Promise<string> {
  return encodeHex(await crypto.subtle.digest("SHA-256", await Deno.readFile(path)));
}

/** Writes a sorted, owner-neutral tar of the directory and returns its size and hash. */
export async function createArchive(sourceDir: string, archivePath: string): Promise<IArchiveInfo> {
  const output = await new Deno.Command("tar", {
    args: [
      "--sort=name",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "-cf",
      resolve(archivePath),
      "-C",
      resolve(sourceDir),
      ".",
    ],
  }).output();
  if (!output.success) throw new Error(`tar failed: ${new TextDecoder().decode(output.stderr)}`);
  return { bytes: (await Deno.stat(archivePath)).size, sha256: await sha256File(archivePath) };
}

/** Scans the tree for the needles and for credential-like text. Symlinks and large files are skipped. */
export async function findLeaks(dir: string, needles: string[]): Promise<ILeak[]> {
  const leaks: ILeak[] = [];
  const decoder = new TextDecoder("latin1");
  const walk = async (current: string): Promise<void> => {
    for await (const entry of Deno.readDir(current)) {
      const path = join(current, entry.name);
      if (entry.isDirectory) {
        await walk(path);
        continue;
      }
      if (!entry.isFile) continue;
      if ((await Deno.stat(path)).size > COMPAT_LEAK_SCAN_MAX_FILE_BYTES) continue;
      const text = decoder.decode(await Deno.readFile(path));
      const file = relative(dir, path);
      for (const needle of needles) {
        if (text.includes(needle)) leaks.push({ file, reason: `contains ${needle}` });
      }
      for (const { pattern, reason } of SECRET_PATTERNS) {
        if (pattern.test(text)) leaks.push({ file, reason });
      }
    }
  };
  await walk(dir);
  return leaks;
}

function seedScript(portal: IPortalSpec): string {
  const dir = `/compat/ws/portals-src/${portal.alias}`;
  return [
    `mkdir -p ${dir}/src`,
    `cd ${dir}`,
    "git init -q -b main",
    `echo "# ${portal.alias}" > README.md`,
    "echo 'export const base = 1;' > src/base.ts",
    "git add -A",
    `GIT_AUTHOR_DATE=${SEED_DATE} GIT_COMMITTER_DATE=${SEED_DATE} git commit -q -m "Seed ${portal.alias}"`,
    `git branch ${BASE_BRANCH}`,
    portal.extra,
    "cd /compat/ws",
  ].join("\n");
}

function prepareScript(): string {
  const reference = "deno run -A --config /compat/ref/deno.json /compat/ref/scripts";
  return [
    "set -e",
    `${reference}/scaffold.ts /compat/ws > /dev/null`,
    `EXA_MIGRATIONS_DIR=/compat/ref/migrations ${reference}/setup_db.ts > /dev/null`,
    "cp -r /compat/ref/Blueprints/Agents/. /compat/ws/Blueprints/Agents/",
    "cp -r /compat/ref/Blueprints/Flows/. /compat/ws/Blueprints/Flows/",
    ...PORTALS.map(seedScript),
    ...PORTALS.map((portal) =>
      `exactl portal add /compat/ws/portals-src/${portal.alias} ${portal.alias} --default-branch main --execution-strategy ${portal.strategy}`
    ),
  ].join("\n");
}

function daemonScript(): string {
  const waits = FIXTURE_PLANS.map((plan) =>
    [
      `compat_checkpoint inject:${plan.requestId}`,
      `exactl log wait --event execution.completed --since "$COMPAT_REPLY" --payload '%${plan.requestId}%' --timeout ${LOG_WAIT_TIMEOUT_SECONDS}`,
    ].join("\n")
  );
  return ["set -e", "exactl daemon start", ...waits, "exactl daemon stop"].join("\n");
}

function conflictScript(): string {
  return [
    "set -e",
    "cd /compat/ws/portals-src/conflict-app",
    `git checkout -q ${BASE_BRANCH}`,
    `echo 'export const conflict = "base-changed";' > ${CONFLICT_FILE}`,
    "git add -A",
    `GIT_AUTHOR_DATE=${SEED_DATE} GIT_COMMITTER_DATE=${SEED_DATE} git commit -q -m "Change conflict file on base"`,
    "git checkout -q main",
  ].join("\n");
}

async function runStep(
  label: string,
  result: Promise<{ observation: { exitCode: number; stderr: string } }>,
): Promise<void> {
  const { observation } = await result;
  if (observation.exitCode !== 0) {
    throw new Error(
      `fixture step "${label}" failed with exit ${observation.exitCode}: ${observation.stderr.slice(-1500)}`,
    );
  }
}

interface IFixtureState {
  reviews: IReviewRow[];
  artifacts: IArtifactRow[];
  maxRowid: number;
}

async function readState(copyDir: string): Promise<IFixtureState> {
  const resolver = await createCopyResolver(copyDir);
  const database = new Database(await resolver.resolve("@Runtime/journal.db"), { readonly: true });
  try {
    return {
      reviews: database.prepare("SELECT trace_id, branch, base_branch, worktree_path FROM reviews").all<IReviewRow>(),
      artifacts: database.prepare("SELECT id, request_id FROM artifacts").all<IArtifactRow>(),
      maxRowid: database.prepare("SELECT MAX(rowid) AS max_rowid FROM activity").get<IMaxRow>()?.max_rowid ?? 0,
    };
  } finally {
    database.close();
  }
}

function describeReviews(
  state: IFixtureState,
): { reviews: IFixtureReview[]; artifactProbe: IArtifactProbe; findings: string[] } {
  const reviews: IFixtureReview[] = [];
  const findings: string[] = [];
  let artifactProbe: IArtifactProbe = {
    status: "no-recipe",
    detail: "A code-analyst plan produced no artifacts row. The agent blueprints must be installed from the reference.",
  };
  for (const plan of FIXTURE_PLANS) {
    if (plan.kind === FixtureReviewKind.ARTIFACT) {
      const artifact = state.artifacts.find((row) => row.request_id === plan.requestId);
      if (artifact === undefined) continue;
      artifactProbe = {
        status: "created",
        detail:
          `An approved plan with agent_role ${plan.agentRole}, a read-only Solo blueprint, produced ${artifact.id}.`,
      };
      reviews.push({
        kind: plan.kind,
        reviewRef: artifact.id,
        requestId: plan.requestId,
        traceId: plan.traceId,
        portal: plan.portal,
        branch: null,
        baseBranch: null,
        worktreePath: null,
        provenance:
          "Daemon execution of a read-only plan injected at a checkpoint, with the reference's agent blueprints installed.",
      });
      continue;
    }
    const row = state.reviews.find((candidate) => candidate.trace_id === plan.traceId);
    if (row === undefined) throw new Error(`no review row for ${plan.requestId}`);
    reviews.push({
      kind: plan.kind,
      reviewRef: plan.requestId,
      requestId: plan.requestId,
      traceId: plan.traceId,
      portal: plan.portal,
      branch: row.branch,
      baseBranch: row.base_branch,
      worktreePath: row.worktree_path,
      provenance: "Daemon execution of an approved write_file plan injected at a checkpoint, with the mock provider.",
    });
    if (plan.kind === FixtureReviewKind.BRANCH_CONFIG_CODE && row.worktree_path !== null) {
      findings.push(
        "The portal configured with execution_strategy=branch still produced a worktree review, because the reference forces the worktree strategy for every portal plan.",
      );
    }
  }
  return { reviews, artifactProbe, findings: [...findings, REQUEST_FILE_FINDING] };
}

/** Builds the workspace with the frozen binaries, then writes `fixture.tar` and `fixture_manifest.json` into outDir. */
export async function generateFixture(binding: ICandidateBinding, outDir: string): Promise<IFixtureManifest> {
  const buildDir = resolve(join(SANDBOX_TREE_ROOT, "fixture-build"));
  await Deno.remove(buildDir, { recursive: true }).catch(() => undefined);
  const copyDir = join(buildDir, "ws");
  const homeDir = join(buildDir, "home");
  await Deno.mkdir(copyDir, { recursive: true });
  await Deno.mkdir(homeDir, { recursive: true });
  const runBinding = await materializeWritableTrees(binding, buildDir);
  const common = { binding: runBinding, copyDir, homeDir };

  await runStep("prepare", runSession({ ...common, script: prepareScript(), onCheckpoint: () => Promise.resolve("") }));

  const resolver = await createCopyResolver(copyDir);
  await runStep(
    "daemon",
    runSession({
      ...common,
      script: daemonScript(),
      expectedCheckpoints: FIXTURE_PLANS.map((plan) => `inject:${plan.requestId}`),
      onCheckpoint: async (label) => {
        const plan = FIXTURE_PLANS.find((candidate) => label === `inject:${candidate.requestId}`);
        if (plan === undefined) throw new Error(`unknown checkpoint ${label}`);
        const since = new Date().toISOString();
        await Deno.writeTextFile(
          await resolver.resolve(`@Workspace/Active/${plan.requestId}_plan.md`),
          renderPlan(plan),
        );
        return since;
      },
    }),
  );
  await runStep(
    "conflict",
    runSession({ ...common, script: conflictScript(), onCheckpoint: () => Promise.resolve("") }),
  );

  const state = await readState(copyDir);
  const described = describeReviews(state);
  const leaks = await findLeaks(copyDir, [Deno.env.get("HOME") ?? "/nonexistent-home", "exaix-sandboxes"]);
  if (leaks.length > 0) {
    throw new Error(
      `the fixture leaks: ${
        leaks.map((leak) => `${leak.file} (${leak.reason})`).join(", ".padEnd(COMMAND_SEPARATOR_LENGTH))
      }`,
    );
  }

  await Deno.mkdir(outDir, { recursive: true });
  const archive = await createArchive(copyDir, join(outDir, "fixture.tar"));
  const manifest: IFixtureManifest = {
    schemaVersion: COMPAT_SCHEMA_VERSION,
    archiveFile: "fixture.tar",
    archiveSha256: archive.sha256,
    archiveBytes: archive.bytes,
    binding: binding.label,
    journalBaselineRowid: state.maxRowid,
    ...described,
  };
  await Deno.writeTextFile(join(outDir, "fixture_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
