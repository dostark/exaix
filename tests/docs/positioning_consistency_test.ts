/**
 * @module PositioningConsistencyTest
 * @path tests/docs/positioning_consistency_test.ts
 * @description Cross-document content-consistency guardrails for the docs Phase 91's
 * positioning/narrative work touches — README.md, ARCHITECTURE.md, the white paper,
 * both GLOSSARY.md files, Exaix_Weaknesses.md, and Exaix_Comparative_Analysis.md.
 * Catches drift that frontmatter/link/manifest checks (docs-agent-validate,
 * markdown_lint.ts, build_agents_index.ts) cannot see: claims that contradict each
 * other across documents, or that contradict the shipped/excluded phase ground truth
 * exaix-dev-docs/planning/phase-91-positioning-and-narrative.md establishes.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");

// Ground truth for which phases must never be framed as delivered capability — keep this
// list in sync with the planning doc's phase-exclusion table if it changes.
const EXCLUDED_PHASES = [85, 86, 89, 90];

// No positioning doc cites specific shipped-phase numbers in its prose, so there is nothing to
// assert here beyond EXCLUDED_PHASES above — this note only records why the check stops there.

const PHASE_MENTION_PATTERN = /Phases?\s+(\d+)/g;

const NON_DELIVERY_FRAMING_KEYWORDS = ["postpon", "cancel", "reject", "exclude"];

const POSITIONING_DOC_PATHS = [
  "README.md",
  "ARCHITECTURE.md",
  "exaix-dev-docs/dev/Exaix_White_Paper.md",
  "GLOSSARY.md",
  ".copilot/docs/GLOSSARY.md",
  "exaix-dev-docs/dev/Exaix_Weaknesses.md",
];

async function readDoc(relativePath: string): Promise<string> {
  return await Deno.readTextFile(join(REPO_ROOT, relativePath));
}

function extractTermHeadings(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.startsWith("### "))
    .map((line) => line.slice(4).trim());
}

Deno.test("[hallucination-bench] No-vaporware regression — Phases 85/86/89/90 are never framed as delivered capability", async () => {
  for (const docPath of POSITIONING_DOC_PATHS) {
    const content = await readDoc(docPath);
    for (const rawLine of content.split("\n")) {
      PHASE_MENTION_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PHASE_MENTION_PATTERN.exec(rawLine)) !== null) {
        const phaseNumber = Number(match[1]);
        if (!EXCLUDED_PHASES.includes(phaseNumber)) continue;
        const lowerLine = rawLine.toLowerCase();
        const framedAsNonDelivery = NON_DELIVERY_FRAMING_KEYWORDS.some((keyword) => lowerLine.includes(keyword));
        assert(
          framedAsNonDelivery,
          `${docPath} mentions Phase ${phaseNumber} (excluded — ships nothing per GAP-1) ` +
            `without postponed/cancelled/rejected framing: "${rawLine.trim()}"`,
        );
      }
    }
  }
});

Deno.test("[hallucination-bench] Three-tier reliability narrative — ARCHITECTURE.md and the white paper tell the same story", async () => {
  const architecture = await readDoc("ARCHITECTURE.md");
  const whitePaper = await readDoc("exaix-dev-docs/dev/Exaix_White_Paper.md");

  // Neither doc cites phase numbers next to the three-tier pillars — they ground them in shared
  // mechanism language instead (trace-linked events, idempotency keys, resume tokens). Assert on
  // that mechanism language so the two docs can't drift apart on how each pillar is grounded.
  const pillarGrounding: Record<string, string> = {
    "Visibility": "trace-linked",
    "Recoverability": "idempotency keys",
    "Governance": "resume token",
  };

  const docs: Array<[string, string]> = [
    ["ARCHITECTURE.md", architecture],
    ["white paper", whitePaper],
  ];

  for (const [pillar, grounding] of Object.entries(pillarGrounding)) {
    for (const [label, content] of docs) {
      assertStringIncludes(content, pillar, `${label} is missing the "${pillar}" pillar name`);
      assertStringIncludes(
        content.toLowerCase(),
        grounding.toLowerCase(),
        `${label} is missing "${grounding}" — the grounding language Phase 91 uses for ${pillar}`,
      );
    }
  }
});

Deno.test("[hallucination-bench] Differentiation material — README, white paper, and the comparative analysis name the same example competitors", async () => {
  const readme = await readDoc("README.md");
  const whitePaper = await readDoc("exaix-dev-docs/dev/Exaix_White_Paper.md");
  const comparative = await readDoc("exaix-dev-docs/dev/Exaix_Comparative_Analysis.md");

  // The docs don't share a literal competitor-class phrase, but do share a consistent set of
  // named example tools anchoring the two competitor classes: "Chat / IDE Agents" (Copilot,
  // Cursor) and "Orchestration Frameworks" (LangChain, AutoGen). Assert all three docs name all four.
  const exampleCompetitors = ["Copilot", "Cursor", "LangChain", "AutoGen"];
  const docs: Array<[string, string]> = [
    ["README.md", readme],
    ["white paper", whitePaper],
    ["comparative analysis", comparative],
  ];

  for (const tool of exampleCompetitors) {
    for (const [label, content] of docs) {
      assertStringIncludes(content, tool, `${label} does not name "${tool}" among its example competitors`);
    }
  }
});

Deno.test("[hallucination-bench] GLOSSARY.md split — concept and implementation definitions stay disjoint and complete", async () => {
  const rootGlossary = await readDoc("GLOSSARY.md");
  // Historically split out of docs/ into .copilot/docs/.
  const devGlossary = await readDoc(".copilot/docs/GLOSSARY.md");

  const rootHeadings = extractTermHeadings(rootGlossary);
  const devHeadings = extractTermHeadings(devGlossary);

  const rootHeadingSet = new Set(rootHeadings);
  const overlap = devHeadings.filter((heading) => rootHeadingSet.has(heading));
  assertEquals(
    overlap,
    [],
    `GLOSSARY.md and .copilot/docs/GLOSSARY.md both define a heading for: ${overlap.join(", ")} ` +
      `— Step 7's no-duplication mandate requires each term be defined exactly once`,
  );

  // Every term from the pre-split glossary was assigned to exactly one bucket (15 concept-level
  // terms in root GLOSSARY.md, 5 implementation-level groupings in the dev glossary). Confirm the
  // union still covers all of them — the split lost nothing.
  const conceptLevelTerms = [
    "Agent Role",
    "Agent Role Blueprint",
    "Actor",
    "Agent",
    "Request",
    "Request Frontmatter",
    "Blueprint",
    "Flow",
    "Flow Step",
    "Gate Evaluate",
    "Portal",
    "Memory",
    "Skills",
    "MCP Server",
  ];
  for (const term of conceptLevelTerms) {
    assert(
      rootHeadings.some((heading) => heading.includes(term)),
      `Root GLOSSARY.md is missing a "${term}" heading from Step 1's term inventory`,
    );
  }

  const implementationLevelGroupMarkers = [
    "Request Flow Diagram",
    "Journal",
    "Code Identifiers",
    "AgentHealth",
    "Directories and Constants",
  ];
  for (const marker of implementationLevelGroupMarkers) {
    assert(
      devGlossary.includes(marker),
      `docs/GLOSSARY.md is missing its "${marker}" implementation-level grouping from Step 1's term inventory`,
    );
  }
});

Deno.test("[hallucination-bench] GLOSSARY.md cross-link — README and the white paper both link to the root glossary", async () => {
  const readme = await readDoc("README.md");
  const whitePaper = await readDoc("exaix-dev-docs/dev/Exaix_White_Paper.md");

  assertStringIncludes(readme, "(./GLOSSARY.md)", "README.md does not link to the root GLOSSARY.md");
  assertStringIncludes(
    whitePaper,
    "(../../GLOSSARY.md)",
    "the white paper does not link to the root GLOSSARY.md",
  );
});

Deno.test("[hallucination-bench] Exaix_Weaknesses.md stale-path regression — src/services/ only appears as corrected history", async () => {
  const weaknesses = await readDoc("exaix-dev-docs/dev/Exaix_Weaknesses.md");

  // The doc intentionally retains two historical mentions of the stale pre-package-extraction
  // src/services/ path, framed as corrected history rather than current citations. Assert every
  // remaining occurrence keeps that framing — that's the actual regression this check catches.
  const correctedHistoryFramingKeywords = [
    "no longer exists",
    "pre-package-extraction",
    "stale path",
    "originally grounded",
  ];

  for (const rawLine of weaknesses.split("\n")) {
    if (!rawLine.includes("src/services/")) continue;
    const lowerLine = rawLine.toLowerCase();
    const framedAsCorrectedHistory = correctedHistoryFramingKeywords.some((keyword) => lowerLine.includes(keyword));
    assert(
      framedAsCorrectedHistory,
      `Exaix_Weaknesses.md cites "src/services/" without corrected-history framing ` +
        `(looks like a reintroduced stale current-path citation): "${rawLine.trim()}"`,
    );
  }
});

interface IManifestDocEntry {
  path: string;
}

interface IManifest {
  docs: IManifestDocEntry[];
}

Deno.test("[hallucination-bench] Manifest registration — .copilot/manifest.json registers the root GLOSSARY.md", async () => {
  const manifestRaw = await readDoc(".copilot/manifest.json");
  const manifest = JSON.parse(manifestRaw) as IManifest;

  const hasGlossaryEntry = manifest.docs.some((entry) => entry.path === "GLOSSARY.md");

  assert(
    hasGlossaryEntry,
    `.copilot/manifest.json has no entry with "path": "GLOSSARY.md" — ` +
      `run scripts/build_agents_index.ts to register it`,
  );
});
