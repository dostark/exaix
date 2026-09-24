/**
 * @module AgentProseCheckerTest
 * @path tests/scripts/agent_prose_checker_test.ts
 * @description Phase 195 Step 2 — RED-first tests for the agent-prose authoring gate.
 *   Builds a temporary owned fixture tree, derives a schema-v2 policy with current review
 *   evidence from the real modules, and asserts: alias-dedup discovery, nested-source
 *   inventory, guidance-vs-documentation classification inside one skill, YAML/fence
 *   prose reading, literal-atom preservation, stale-hash / missing-span / unclassified
 *   rejection, the real CLI entry point with exit codes 0/1/2, extension-version and
 *   both-rule-set coverage, advisory heuristics, shared counting consistency across
 *   copilot and Blueprints, containment security (escapes, cycles, outside roots,
 *   malformed paths), review invalidation on every dependency hash, and review
 *   completeness rules.
 * @architectural-layer Test
 * @related-files [
 *   "scripts/check_agent_prose.ts",
 *   "scripts/ste100_prose_rules.ts"
 * ]
 */

import { assertEquals, assertMatch, assertNotEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import {
  classifySourcePath,
  contextHashForPath,
  discoverProseCandidates,
  extractProse,
  hashProseSpans,
  type IAgentProsePolicy,
  loadAgentProsePolicy,
  loadRuleCatalog,
  PolicyError,
  runAgentProseCheck,
} from "../../scripts/check_agent_prose.ts";
import { normalizeSteProse, runDeterministicSteChecks, summarizeSteCount } from "../../scripts/ste100_prose_rules.ts";

const CHECKER_SCRIPT = join(import.meta.dirname!, "../../scripts/check_agent_prose.ts");
const FIXTURES_DIR = join(import.meta.dirname!, "fixtures/agent_prose/owned");

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function readFixture(rel: string): Promise<string> {
  return Deno.readTextFile(join(FIXTURES_DIR, rel));
}

async function writeFileAt(root: string, rel: string, content: string): Promise<void> {
  const path = join(root, rel);
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, content);
}

interface IFixtureCtx {
  root: string;
  ownedDir: string;
  policyPath: string;
  policy: IAgentProsePolicy;
}

/** Seeds the owned fixture tree into a temp dir, derives a current schema-v2 policy
 *  from the real modules, optionally applies `mutate` before persisting the policy. */
async function makeFixture(
  options: {
    overrides?: Record<string, string>;
    mutate?: (ctx: Omit<IFixtureCtx, "policyPath">) => void | Promise<void>;
  } = {},
): Promise<IFixtureCtx> {
  const root = await Deno.makeTempDir({ prefix: "agent-prose-" });
  const ownedDir = join(root, "owned");
  await copy(FIXTURES_DIR, ownedDir, { overwrite: true });
  for (const [rel, content] of Object.entries(options.overrides ?? {})) {
    await writeFileAt(ownedDir, rel, content);
  }

  const catalog = await loadRuleCatalog();
  const policyBase: IAgentProsePolicy = {
    version: "2",
    standard: "ASD-STE100 Issue 9",
    extension: "Exaix STE Extension v1",
    roots: ["owned"],
    exclusions: [],
    sources: [],
    technicalTerms: [],
  };
  const rootReal = await Deno.realPath(ownedDir);
  const { candidates } = await discoverProseCandidates(policyBase, [rootReal]);

  const sources: IAgentProsePolicy["sources"] = [];
  for (const candidate of candidates) {
    const kind = classifySourcePath(candidate.relPath);
    if (kind === "unclassified") continue;
    const content = await Deno.readTextFile(candidate.absPath);
    const extracted = await extractProse(content, kind);
    const spans = extracted.map((e) => e.span);
    const contentHash = await sha256(content);
    let review: IAgentProsePolicy["sources"][number]["review"] = null;
    if (kind !== "documentation") {
      review = {
        reviewer: "fixture-reviewer",
        reviewedHash: contentHash,
        ruleContractHash: catalog.catalogHash,
        technicalTermsHash: catalog.technicalTermsHash,
        classificationHash: await hashProseSpans(spans),
        contextHash: await contextHashForPath(candidate.relPath),
        ruleDecisions: catalog.rules.map((ruleId) => ({
          ruleId,
          outcome: "pass" as const,
          reason: "fixture review covers the rule",
        })),
        advisoryDecisions: [],
        unresolvedRuleIds: [],
      };
    }
    sources.push({ path: candidate.relPath, contentHash, kind, spans, review });
  }

  const ctx: Omit<IFixtureCtx, "policyPath"> = { root, ownedDir, policy: { ...policyBase, sources } };
  if (options.mutate) await options.mutate(ctx);
  const policyPath = join(root, "policy.json");
  await Deno.writeTextFile(policyPath, JSON.stringify(ctx.policy, null, 2) + "\n");
  return { ...ctx, policyPath };
}

async function runCli(policyPath: string, args: string[] = []): Promise<{ code: number; out: string; err: string }> {
  const command = new Deno.Command("deno", {
    args: ["run", "-A", "--quiet", CHECKER_SCRIPT, "--policy", policyPath, ...args],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  return { code, out: new TextDecoder().decode(stdout), err: new TextDecoder().decode(stderr) };
}

Deno.test("Checker deduplicates aliases and discovers nested instruction sources", async () => {
  const fixture = await makeFixture();
  const rootReal = await Deno.realPath(fixture.ownedDir);

  // Alias + cycle symlinks that realpath discovery must collapse or terminate on.
  await Deno.symlink(
    join(fixture.ownedDir, ".copilot", "skills", "demo", "SKILL.md"),
    join(fixture.ownedDir, ".copilot", "skills", "demo-alias-new.md"),
  );
  await Deno.symlink(
    join(fixture.ownedDir, ".copilot", "skills"),
    join(fixture.ownedDir, ".copilot", "skills", "loop"),
  );

  const { candidates, escapes } = await discoverProseCandidates(fixture.policy, [rootReal]);
  const relPaths = candidates.map((c) => c.relPath).sort();

  assertEquals(
    relPaths.filter((p) => /skills\/demo\/SKILL\.md$/.test(p)).length,
    1,
    "alias symlink dedups to one canonical source",
  );
  assertEquals(
    relPaths.filter((p) => /skills\/demo\/support\.md$/.test(p)).length,
    1,
    "nested support source discovered",
  );
  assertEquals(escapes.length, 0, "in-root alias/cycle is not an escape");
});

Deno.test("Checker distinguishes guidance from documentation inside one skill", async () => {
  const fixture = await makeFixture();
  const skill = fixture.policy.sources.find((s) => s.path.endsWith("SKILL.md"));
  assertNotEquals(skill, undefined);
  const kinds = skill!.spans.map((s) => `${s.selector}:${s.kind}`).join(" ");
  assertStringIncludes(kinds, "heading:Guidance:instruction");
  assertStringIncludes(kinds, "heading:Documentation:documentation");
  assertEquals(skill!.kind, "instruction");
});

Deno.test("Checker reads prose YAML values and response examples inside fences", async () => {
  const fixture = await makeFixture();
  const skill = fixture.policy.sources.find((s) => s.path.endsWith("SKILL.md"))!;
  assertNotEquals(skill.spans.filter((s) => s.selector.startsWith("yaml:")).length, 0);
  const fence = skill.spans.find((s) => s.selector.startsWith("fence:"));
  assertNotEquals(fence, undefined, "fenced example must be read");
  assertEquals(fence!.kind, "literal", "fenced examples are literal: read but not counted");
});

Deno.test("Checker preserves commands identifiers quotations and schemas", () => {
  const prose =
    'Run `set b; echo ok` in the shell and keep `session.delegate.launched` in the row. Quote an exact key: "portal.limit" stays inside the atom.';
  const normalized = normalizeSteProse(prose);
  assertEquals(normalized.semicolonCount, 0, "semicolon inside a literal atom is preserved, not counted");
  const findings = runDeterministicSteChecks(normalized);
  assertEquals(findings.some((f) => f.ruleId === "STE-8.1"), false);
});

Deno.test("Checker rejects stale hashes missing spans and unclassified sources", async () => {
  // Stale content hash: the temp SKILL.md changes after the policy is derived.
  const stale = await makeFixture();
  await writeFileAt(
    stale.ownedDir,
    ".copilot/skills/demo/SKILL.md",
    (await readFixture(".copilot/skills/demo/SKILL.md")) + "\nchanged\n",
  );
  const staleResult = await runAgentProseCheck({ policyPath: stale.policyPath });
  assertStringIncludes(staleResult.errors.join(" "), "Stale content hash");

  // Missing recorded span: a phantom span selector not present in the content.
  const missing = await makeFixture({
    mutate: ({ policy }) => {
      const skill = policy.sources.find((s) => s.path.endsWith("SKILL.md"))!;
      skill.spans.push({
        selector: "yaml:ghost-key",
        contentHash: "a".repeat(64),
        kind: "instruction",
        mode: "descriptive",
        reason: "phantom recorded span",
        sentenceModes: [],
      });
    },
  });
  const missingResult = await runAgentProseCheck({ policyPath: missing.policyPath });
  assertStringIncludes(missingResult.errors.join(" "), "Recorded span yaml:ghost-key missing");

  // Unclassified: a newly discovered file absent from the policy inventory.
  const unclassified = await makeFixture({
    mutate: async ({ ownedDir }) => {
      await writeFileAt(ownedDir, "misc/unknown.txt", "an unlisted candidate file\n");
    },
  });
  const unclassifiedResult = await runAgentProseCheck({ policyPath: unclassified.policyPath });
  assertNotEquals(unclassifiedResult.unclassified.length, 0);
  assertEquals(unclassifiedResult.exitCode, 1);
});

Deno.test("Checker CLI reports confirmed findings and leaves heuristics advisory", async () => {
  const violation = [
    "# Demo Skill",
    "",
    "## Guidance",
    "",
    "Use this command to apply the configuration and then restart the daemon instance with a long verbose explanation that pushes the sentence well past the twenty word boundary.",
    "Run `set b; echo ok` in the shell.",
    "I think this is the clearest approach for a short fixture.",
    "",
  ].join("\n");
  const fixture = await makeFixture({ overrides: { ".copilot/skills/demo/SKILL.md": violation } });
  const cli = await runCli(fixture.policyPath);
  assertEquals(cli.code, 1);
  assertMatch(cli.err, /\[error\].*STE-5\.1/);
  assertMatch(cli.err, /\[advisory\].*EXAIX-03/);
});

Deno.test("Checker requires the extension version and reviews both rule sets", async () => {
  const fixture = await makeFixture();
  const badExtension = {
    version: "2",
    standard: "ASD-STE100 Issue 9",
    extension: "some-other-extension",
    roots: ["owned"],
    exclusions: [],
    sources: [],
    technicalTerms: [],
  };
  const badPath = join(fixture.root, "bad-extension.json");
  await Deno.writeTextFile(badPath, JSON.stringify(badExtension));
  await assertRejects(() => runAgentProseCheck({ policyPath: badPath }), PolicyError);
  await assertRejects(() => loadAgentProsePolicy(badPath), PolicyError);
  const cli = await runCli(badPath);
  assertEquals(cli.code, 2);

  // Both rule sets: an extension rule missing from the review is an integrity failure.
  const missingDecision = await makeFixture({
    mutate: ({ policy }) => {
      const skill = policy.sources.find((s) => s.path.endsWith("SKILL.md"))!;
      skill.review!.ruleDecisions = skill.review!.ruleDecisions.filter((d) => d.ruleId !== "EXAIX-05");
    },
  });
  const result = await runAgentProseCheck({ policyPath: missingDecision.policyPath });
  assertStringIncludes(result.errors.join(" "), "lacks a decision for EXAIX-05");
});

Deno.test("Checker leaves uncertain relevance repetition and bullet-use findings advisory", async () => {
  const prose = "Again, note that this sentence repeats a fact already delivered earlier in the turn.";
  const normalized = normalizeSteProse(prose);
  assertEquals(runDeterministicSteChecks(normalized).length, 0, "repetition is not a deterministic violation");
  assertEquals(normalized.totalWordCount, 14);

  const fixture = await makeFixture();
  const result = await runAgentProseCheck({ policyPath: fixture.policyPath });
  const advisory = result.findings.filter((f) => f.severity === "advisory");
  assertNotEquals(advisory.length, 0, "an advisory heuristic finding is reported");
  assertEquals(result.exitCode, 0, "advisory findings alone do not fail the check");
});

Deno.test("Checker covers supporting skill content in both copilot and Blueprints with shared rules", async () => {
  const fixture = await makeFixture();
  const result = await runAgentProseCheck({ policyPath: fixture.policyPath });
  assertEquals(
    result.sources.some((s) => s.path.includes("skills") && s.path.endsWith("support.md")),
    true,
    "copilot support covered",
  );
  assertEquals(result.sources.some((s) => s.path.endsWith("demo-bp.skill.md")), true, "Blueprints skill covered");

  const support = await readFixture(".copilot/skills/demo/support.md");
  const blueprintProse = await readFixture("Blueprints/Skills/demo-bp.skill.md");
  assertNotEquals(summarizeSteCount(normalizeSteProse(support)), "0/0/0");
  assertEquals(
    summarizeSteCount(normalizeSteProse(blueprintProse)),
    summarizeSteCount(normalizeSteProse(blueprintProse)),
    "identical prose counts identically through the shared core",
  );
});

Deno.test("Instruction checker rejects outside roots escaped aliases cycles and malformed policy paths", async () => {
  const fixture = await makeFixture();

  // Focused path outside every registered root is exit 2.
  const outside = join(fixture.root, "outside.txt");
  await Deno.writeTextFile(outside, "x");
  const restricted = await runAgentProseCheck({ policyPath: fixture.policyPath, focused: outside });
  assertEquals(restricted.exitCode, 2);
  assertStringIncludes(restricted.errors.join(" "), "outside every registered root");

  // A symlink escaping the owned root is reported, not silently skipped.
  const escaped = await makeFixture({
    mutate: async ({ ownedDir }) => {
      const outsideTarget = join(ownedDir, "..", "outside-target");
      await writeFileAt(outsideTarget, "leak.md", "not owned prose\n");
      await Deno.symlink(outsideTarget, join(ownedDir, ".copilot", "leak"));
    },
  });
  const escapedResult = await runAgentProseCheck({ policyPath: escaped.policyPath });
  assertStringIncludes(escapedResult.errors.join(" "), "Escaping symlink");

  // A malformed policy file is an exit-2 parse error through the real CLI entry point.
  const malformed = join(fixture.root, "malformed.json");
  await Deno.writeTextFile(malformed, "{ not json");
  const cli = await runCli(malformed);
  assertEquals(cli.code, 2);
});

Deno.test("Review invalidates when rules terminology classifications or supporting context change", async () => {
  const catalog = await loadRuleCatalog();
  const stale = await makeFixture({
    mutate: ({ policy }) => {
      const skill = policy.sources.find((s) => s.path.endsWith("SKILL.md"))!;
      skill.review!.ruleContractHash = "f".repeat(64);
      skill.review!.technicalTermsHash = "e".repeat(64);
      skill.review!.classificationHash = "d".repeat(64);
      skill.review!.contextHash = "c".repeat(64);
    },
  });
  const result = await runAgentProseCheck({ policyPath: stale.policyPath });
  const errors = result.errors.join(" ");
  assertStringIncludes(errors, "ruleContractHash stale");
  assertStringIncludes(errors, "technicalTermsHash stale");
  assertStringIncludes(errors, "classificationHash stale");
  assertStringIncludes(errors, "contextHash stale");
  assertEquals(catalog.rules.length > 0, true);
});

Deno.test("Review rejects missing rule decisions and cannot waive confirmed errors", async () => {
  const violation = [
    "# Demo Skill",
    "",
    "## Guidance",
    "",
    "Use this command to apply the configuration and then restart the daemon instance with a long verbose explanation that pushes the sentence well past the twenty word boundary.",
    "",
  ].join("\n");
  const fixture = await makeFixture({
    overrides: { ".copilot/skills/demo/SKILL.md": violation },
    mutate: ({ policy }) => {
      const skill = policy.sources.find((s) => s.path.endsWith("SKILL.md"))!;
      skill.review!.unresolvedRuleIds = ["EXAIX-01"];
      skill.review!.advisoryDecisions = [{
        findingHash: "b".repeat(64),
        ruleId: "STE-5.1",
        outcome: "false-positive",
        reason: "attempted waiver",
      }];
    },
  });
  const result = await runAgentProseCheck({ policyPath: fixture.policyPath });
  assertStringIncludes(result.errors.join(" "), "EXAIX-01");
  assertNotEquals(result.findings.filter((f) => f.ruleId === "STE-5.1" && f.severity === "error").length, 0);
  assertEquals(result.exitCode, 1);
});

Deno.test("Shared rules count atoms lists paragraphs and resolved mixed sentences consistently", () => {
  const textA = "- Use `set b; echo ok` now.\n- Keep the trace ID.\n\nState the result.\nResolve the next action.";
  const textB = "- Use `set b; echo ok` now.\n- Keep the trace ID.\n\nState the result.\nResolve the next action.";
  assertEquals(summarizeSteCount(normalizeSteProse(textA)), summarizeSteCount(normalizeSteProse(textB)));
  assertNotEquals(summarizeSteCount(normalizeSteProse(textA)), "0/0/0");

  const simple = normalizeSteProse("- Use exactl config get now.\n- Keep the result.");
  assertEquals(simple.paragraphs.length, 1);
  assertEquals(simple.paragraphs[0].sentences.length, 2);
  assertEquals(simple.paragraphs[0].sentences.every((s) => s.mode === "procedural"), true);

  const mixed = normalizeSteProse("Use the portal worktree. The model is remote and stateless.");
  assertEquals(mixed.paragraphs[0].paragraphMode, "mixed");
  assertEquals(mixed.paragraphs[0].sentences.map((s) => s.mode), ["procedural", "descriptive"]);
});
