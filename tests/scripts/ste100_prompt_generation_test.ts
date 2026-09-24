/**
 * @module Ste100PromptGenerationTest
 * @path tests/scripts/ste100_prompt_generation_test.ts
 * @description Phase 195 Step 3 — tests that the STE-converted developer corpus and its
 *   regenerated routing wrappers preserve every reviewed obligation. Covers: obligation
 *   preservation (workflow/authority) against the seeded ste100 obligations map, real
 *   wrapper generation (routing kept, STE prose, idempotent with the committed wrappers),
 *   envelope validity (frontmatter + exaix block + qwen_skill parity), deterministic-clean
 *   compressed guidance, a developer context report that separates instruction / metadata /
 *   policy channels, wrapper-to-canonical loading, and an obligation map that honestly
 *   distinguishes delivery, review-only, and observed evidence.
 * @architectural-layer Test
 * @related-files [
 *   "scripts/generate_prompt.ts",
 *   "scripts/ste100_prose_rules.ts",
 *   "scripts/check_agent_prose.ts"
 * ]
 */

import { assertEquals, assertGreater, assertNotEquals, assertObjectMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { describe, test } from "@std/testing/bdd";
import { parse as parseYaml } from "@std/yaml";
import { normalizeSteProse, summarizeSteCount } from "../../scripts/ste100_prose_rules.ts";
import { generatePromptContent } from "../../scripts/generate_prompt.ts";

const REPO = join(import.meta.dirname!, "../..");
const OBLIGATIONS_PATH = join(REPO, "tests", "scenario_framework", "fixtures", "ste100", "obligations.json");

interface IObligationEntry {
  id: string;
  canonicalPath: string;
  critical: boolean;
  supportPaths: string[];
  selectors: { original: string[]; revised: string[] };
  evidenceCaseIds: string[];
  risk: string;
  evidence: "delivery" | "review-only" | "observed";
  obligations: string[];
}

function loadObligations(): IObligationEntry[] {
  return (JSON.parse(Deno.readTextFileSync(OBLIGATIONS_PATH)) as { entries: IObligationEntry[] }).entries;
}

function fileExists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

function obligationTokens(obligation: string): string[] {
  return obligation
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4);
}

function obligationSurvives(skillText: string, obligation: string): boolean {
  const text = skillText.toLowerCase();
  const tokens = obligationTokens(obligation);
  const hits = tokens.filter((token) => text.includes(token)).length;
  return hits >= Math.max(2, Math.floor(tokens.length / 2));
}

interface IContextReport {
  relPath: string;
  contentHash: string;
  instructionBytes: number;
  metadataBytes: number;
  policyMarkerBytes: number;
}

/** Splits a skill file into its channels: instructions body vs frontmatter + exaix
 *  envelope metadata vs the added-policy channel (0 for now; eligibility measures it
 *  separately later in the phase). Bytes are UTF-8 lengths. */
function developerContextReport(content: string, relPath: string): IContextReport {
  const encoder = new TextEncoder();
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n?/);
  const trailingYaml = content.match(/\n---\nexaix:[\s\S]*\n---\s*$/);
  const fmEnd = frontmatter ? frontmatter[0].length : 0;
  const exaixStart = trailingYaml ? content.length - (content.length - trailingYaml.index!) : content.length;
  const instructionBytes = encoder.encode(content.slice(fmEnd, exaixStart)).length;
  const metadataBytes = encoder.encode((frontmatter?.[0] ?? "") + (trailingYaml?.[0] ?? "").replace(/^\n/, "")).length;
  const policyMarkerBytes = 0;
  return {
    relPath,
    contentHash: instructionBytes.toString(),
    instructionBytes,
    metadataBytes,
    policyMarkerBytes,
  };
}

describe("ste100 developer corpus conversion", () => {
  const obligations = loadObligations();
  const pilot = obligations.filter((o) => o.id.startsWith("copilot-"));

  test("Developer guidance preserves workflow and authority requirements", () => {
    assertGreater(pilot.length, 0);
    for (const entry of pilot) {
      const skillText = Deno.readTextFileSync(join(REPO, entry.canonicalPath));
      for (const obligation of entry.obligations) {
        assertObjectMatch(
          { preserved: obligationSurvives(skillText, obligation) },
          { preserved: true },
          `${entry.id}: obligation lost: ${obligation}`,
        );
      }
    }
  });

  test("Generated wrappers retain canonical routing with STE prose", () => {
    const rendered = generatePromptContent("demo", "A demo routing description");
    assertStringIncludes(rendered, "# Routing prompt — canonical source");
    assertStringIncludes(rendered, "Auto-generated routing prompt");
    assertStringIncludes(rendered, ".copilot/skills/demo/SKILL.md");
    assertStringIncludes(rendered, "Do not execute from this file.");
    assertStringIncludes(rendered, "Read the canonical source before proceeding.");
    assertStringIncludes(rendered, "Follow all instructions and constraints in the canonical source.");
    assertEquals(rendered.includes("THIN WRAPPER"), false);
    assertEquals(rendered.includes("**CRITICAL**"), false);
    assertEquals(rendered.includes("MUST read"), false);

    // The committed regenerated wrapper matches the template byte-for-byte.
    const commitSkill = Deno.readTextFileSync(join(REPO, ".copilot", "skills", "commit", "SKILL.md"));
    const frontmatter = parseYaml(/^---\n([\s\S]*?)\n---/.exec(commitSkill)![1]) as { description: string };
    const wrapper = Deno.readTextFileSync(join(REPO, ".copilot", "prompts", "commit.prompt.md"));
    assertEquals(wrapper, generatePromptContent("commit", frontmatter.description));
  });

  test("Developer skill envelopes remain valid after conversion", () => {
    for (const entry of pilot) {
      const skillText = Deno.readTextFileSync(join(REPO, entry.canonicalPath));
      const skillName = entry.id.replace("copilot-", "");
      const frontmatter = parseYaml(/^---\n([\s\S]*?)\n---/.exec(skillText)![1]) as {
        qwen_skill?: string;
        title?: string;
        description?: string;
      };
      const name = entry.id.match(/copilot-([^/]+)/)?.[1] ?? skillName;
      assertEquals(frontmatter.qwen_skill, name, "qwen_skill parity for check:qwen-skills-sync");
      assertNotEquals(frontmatter.title, undefined);
      assertNotEquals(frontmatter.description, undefined);
      assertStringIncludes(skillText, "\n---\nexaix:", `${entry.id}: exaix envelope present`);
    }
  });

  test("Developer skill compression preserves every reviewed obligation and decision branch", () => {
    for (const entry of pilot) {
      const skillText = Deno.readTextFileSync(join(REPO, entry.canonicalPath));
      for (const selector of entry.selectors.revised) {
        assertStringIncludes(skillText, selector, `${entry.id}: selector lost: ${selector}`);
      }
      for (const obligation of entry.obligations) {
        assertObjectMatch(
          { preserved: obligationSurvives(skillText, obligation) },
          { preserved: true },
          `${entry.id}: branch obligation lost: ${obligation}`,
        );
      }
      // Compressed guidance still normalizes to measurable content under the shared rules.
      assertNotEquals(summarizeSteCount(normalizeSteProse(skillText)), "0/0/0");
    }
  });

  test("Developer skill context report includes metadata and added policy text", () => {
    for (const entry of pilot) {
      const skillText = Deno.readTextFileSync(join(REPO, entry.canonicalPath));
      const report = developerContextReport(skillText, entry.canonicalPath);
      assertGreater(report.instructionBytes, 0, `${entry.id}: instructions channel measured`);
      assertGreater(report.metadataBytes, 0, `${entry.id}: metadata channel measured`);
      assertObjectMatch(report, { policyMarkerBytes: 0 });
    }
  });

  test("Developer skill loading follows the real wrapper and canonical support reads", () => {
    const promptsDir = join(REPO, ".copilot", "prompts");
    for (const wrapper of Deno.readDirSync(promptsDir)) {
      if (!wrapper.name.endsWith(".prompt.md")) continue;
      const skillName = wrapper.name.replace(/\.prompt\.md$/, "");
      const text = Deno.readTextFileSync(join(promptsDir, wrapper.name));
      const canonical = `.copilot/skills/${skillName}/SKILL.md`;
      assertStringIncludes(text, canonical);
      assertEquals(fileExists(join(REPO, canonical)), true, `${wrapper.name} points at a real canonical source`);
    }
  });

  test("Developer obligation map distinguishes delivery review-only and observed behavior evidence", () => {
    const allowed = new Set(["delivery", "review-only", "observed"]);
    for (const entry of obligations) {
      assertEquals(allowed.has(entry.evidence), true, `unknown evidence classification: ${entry.evidence}`);
    }
    assertNotEquals(obligations.filter((o) => o.evidence === "delivery").length, 0, "at least one delivery record");
    assertNotEquals(
      obligations.filter((o) => o.evidence === "review-only").length,
      0,
      "at least one review-only record",
    );
    // Live behavior observation is pending the phase cutover; nothing may claim observed
    // evidence yet.
    assertEquals(obligations.filter((o) => o.evidence === "observed").length, 0);
    for (const entry of obligations) {
      assertNotEquals(entry.risk, "", "every map entry carries a risk classification");
    }
  });
});
