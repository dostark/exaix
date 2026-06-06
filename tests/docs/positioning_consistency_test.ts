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

// Ground truth from the plan's "Constraints" section (verbatim phase numbers — keep
// this list and the plan's wording in sync; updating one should prompt updating the
// other): "Phases explicitly excluded from this narrative... Phase 85 (postponed),
// Phase 86 (cancelled), Phase 89 (cancelled), Phase 90 (cancelled)" plus GAP-1
// ("EXCLUDE — ships nothing").
const EXCLUDED_PHASES = [85, 86, 89, 90];

// "All positioning claims must be grounded in shipped capabilities (Phases 82-84,
// 87, 88...)" — 82 is hedged ("hardening in progress, do not claim complete" per the
// Step 1 audit table), 83/84/87/88 ship complete. No positioning doc cites these by
// number in its prose (see Check 2's note), so there is no string to assert on —
// recorded here only so a reader can see the full shipped/excluded ground truth
// this suite's checks are derived from in one place, alongside EXCLUDED_PHASES.

const PHASE_MENTION_PATTERN = /Phases?\s+(\d+)/g;

const NON_DELIVERY_FRAMING_KEYWORDS = ["postpon", "cancel", "reject", "exclude"];

const POSITIONING_DOC_PATHS = [
  "README.md",
  "ARCHITECTURE.md",
  "exaix-dev-docs/dev/Exaix_White_Paper.md",
  "GLOSSARY.md",
  "docs/GLOSSARY.md",
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

Deno.test("No-vaporware regression — Phases 85/86/89/90 are never framed as delivered capability", async () => {
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

Deno.test("Three-tier reliability narrative — ARCHITECTURE.md and the white paper tell the same story", async () => {
  const architecture = await readDoc("ARCHITECTURE.md");
  const whitePaper = await readDoc("exaix-dev-docs/dev/Exaix_White_Paper.md");

  // Adapted from the plan's "cite the same grounding phases for each (87 for
  // Visibility; 83 complete + 82 hedged for Recoverability; 84 for Governance)":
  // neither shipped doc actually cites phase numbers next to the three-tier
  // pillars — both ground them in shared *mechanism* language instead (typed
  // trace-linked events, idempotency keys, resume tokens). Asserting on literal
  // phase-number citations that don't exist in the prose would make this check
  // permanently red against the real, already-landed doc state, defeating its
  // purpose as a forward-looking drift guard. This is the substantive property
  // the plan's check protects: the two docs cannot drift into grounding the same
  // pillar in different mechanisms. (Documented as a deviation in the commit body.)
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

Deno.test("Differentiation material — README, white paper, and the comparative analysis name the same example competitors", async () => {
  const readme = await readDoc("README.md");
  const whitePaper = await readDoc("exaix-dev-docs/dev/Exaix_White_Paper.md");
  const comparative = await readDoc("exaix-dev-docs/dev/Exaix_Comparative_Analysis.md");

  // Adapted from the plan's "competitor classes ... (chat/IDE agents, cloud
  // orchestration platforms, lightweight workflow scripts)": none of those three
  // literal phrases appear in the shipped docs. What the docs actually share, and
  // what would visibly drift if an editor swapped one doc's examples without the
  // others, is a consistent set of named example tools anchoring the two
  // competitor classes Phase 91 grounds its differentiation narrative in — "Chat /
  // IDE Agents" (Copilot, Cursor) and "Orchestration Frameworks" (LangChain,
  // AutoGen). Assert all three docs name all four. (Documented as a deviation in
  // the commit body.)
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

Deno.test("GLOSSARY.md split — concept and implementation definitions stay disjoint and complete", async () => {
  const rootGlossary = await readDoc("GLOSSARY.md");
  // Relocated out of the exaix-dev-docs submodule to docs/GLOSSARY.md after this
  // plan was written (the plan assumes exaix-dev-docs/dev/GLOSSARY.md — see commit
  // body for the path-discrepancy note).
  const devGlossary = await readDoc("docs/GLOSSARY.md");

  const rootHeadings = extractTermHeadings(rootGlossary);
  const devHeadings = extractTermHeadings(devGlossary);

  const rootHeadingSet = new Set(rootHeadings);
  const overlap = devHeadings.filter((heading) => rootHeadingSet.has(heading));
  assertEquals(
    overlap,
    [],
    `GLOSSARY.md and docs/GLOSSARY.md both define a heading for: ${overlap.join(", ")} ` +
      `— Step 7's no-duplication mandate requires each term be defined exactly once`,
  );

  // Step 1's audit assigned every term in the pre-split glossary to exactly one
  // bucket: 15 concept-level terms to the new root GLOSSARY.md, and 5
  // implementation-level groupings retained in the dev glossary. Confirm the
  // union of the two documents still covers every inventoried term/grouping —
  // i.e., the split lost nothing.
  const conceptLevelTerms = [
    "Identity",
    "Identity Blueprint",
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

Deno.test("GLOSSARY.md cross-link — README and the white paper both link to the root glossary", async () => {
  const readme = await readDoc("README.md");
  const whitePaper = await readDoc("exaix-dev-docs/dev/Exaix_White_Paper.md");

  assertStringIncludes(readme, "(./GLOSSARY.md)", "README.md does not link to the root GLOSSARY.md");
  assertStringIncludes(
    whitePaper,
    "(../../GLOSSARY.md)",
    "the white paper does not link to the root GLOSSARY.md",
  );
});

Deno.test("Exaix_Weaknesses.md stale-path regression — src/services/ only appears as corrected history", async () => {
  const weaknesses = await readDoc("exaix-dev-docs/dev/Exaix_Weaknesses.md");

  // Step 6 removed stale `src/services/` citations that pointed at the
  // pre-package-extraction (Phase 76) layout as if it were current. The document
  // intentionally retains two historical mentions explaining *that* correction —
  // a literal zero-occurrence assertion (the plan's literal wording) would fail
  // against that deliberately-landed content. Assert instead that every remaining
  // occurrence is framed as corrected history, not as a current citation — the
  // actual regression this check exists to catch. (Documented as a deviation in
  // the commit body.)
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

Deno.test("Manifest registration — .copilot/manifest.json registers the root GLOSSARY.md", async () => {
  const manifestRaw = await readDoc(".copilot/manifest.json");
  const manifest = JSON.parse(manifestRaw) as IManifest;

  const hasGlossaryEntry = manifest.docs.some((entry) => entry.path === "GLOSSARY.md");

  assert(
    hasGlossaryEntry,
    `.copilot/manifest.json has no entry with "path": "GLOSSARY.md" — ` +
      `run scripts/build_agents_index.ts to register it`,
  );
});
