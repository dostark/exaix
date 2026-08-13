/**
 * @module CheckDocSectionRefsTest
 * @path tests/scripts/check_doc_section_refs_test.ts
 * @description Tests for scripts/check_doc_section_refs.ts — the quoted-citation gate
 *   that validates `File.md §"Heading Text"` (cross-file) and `§"Heading Text"`
 *   (self-referencing) prose citations against the real headings of their target file.
 *   Only the QUOTED form is validated: the quote marks are the signal that the author
 *   intends an exact, verifiable title, and unquoted mid-sentence citations (`§2`,
 *   `§F`, `File.md § Some Heading used inline...`) have no reliable text boundary to
 *   check, so they are intentionally left unvalidated (see module docstring in the
 *   script under test for the false-positive analysis that motivated this scope).
 * @architectural-layer Script (test)
 * @dependencies [@std/assert, @std/fs, @std/path]
 * @related-files [scripts/check_doc_section_refs.ts, scripts/check_md_paths.ts]
 */

import { assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { checkDocSectionRefs } from "../../scripts/check_doc_section_refs.ts";

async function sandbox(): Promise<{ root: string; cleanup: () => void }> {
  const root = await Deno.makeTempDir({ prefix: "doc_section_refs_" });
  return { root, cleanup: () => Deno.removeSync(root, { recursive: true }) };
}

Deno.test("[section-refs] a cross-file quoted citation matching a real heading passes", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(
      join(root, "ARCHITECTURE.md"),
      "### 7. **Packages vs. Services — Placement Model**\n\nbody\n",
    );
    await Deno.writeTextFile(
      join(root, "README.md"),
      'Read ARCHITECTURE.md §"Packages vs. Services — Placement Model" first.\n',
    );
    const r = await checkDocSectionRefs(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
    assertEquals(r.ok, true);
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] the ordinal prefix on the real heading is ignored when matching", async () => {
  // Regression: the exact bug this checker exists to catch. Five real citations in
  // this repo named a section by title only ("Packages vs. Services — Placement
  // Model"); the actual heading additionally carried a "7. " ordinal prefix. A
  // citation must not be forced to also cite the ordinal.
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "ARCHITECTURE.md"), "### 7. Packages vs. Services\n\nbody\n");
    await Deno.writeTextFile(root + "/x.md", 'See ARCHITECTURE.md §"Packages vs. Services".\n');
    const r = await checkDocSectionRefs(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] a quoted citation naming a section title that never existed is flagged", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "ARCHITECTURE.md"), "## Some Other Section\n\nbody\n");
    await Deno.writeTextFile(
      root + "/x.md",
      'Read ARCHITECTURE.md §"Packages vs. Services — Placement Model" first.\n',
    );
    const r = await checkDocSectionRefs(root);
    assertEquals(r.ok, false);
    assertEquals(r.violations.length, 1);
    assertEquals(r.violations[0].targetFile, "ARCHITECTURE.md");
    assertEquals(r.violations[0].citedTitle, "Packages vs. Services — Placement Model");
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] a citation word-wrapped across a soft line break still resolves", async () => {
  // Regression: exaix-dev-docs/dev/Exaix_Package_Migration_Plan.md wraps its prose
  // at ~100 chars, splitting "`ARCHITECTURE.md`" and the §-citation naming its
  // section across two source lines that render as one flowing sentence.
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(
      join(root, "ARCHITECTURE.md"),
      "### 7. **Packages vs. Services — Placement Model**\n\nbody\n",
    );
    await Deno.writeTextFile(
      root + "/x.md",
      "The full placement model lives in `ARCHITECTURE.md`\n" +
        '§"Packages vs. Services — Placement Model". Run that check first.\n',
    );
    const r = await checkDocSectionRefs(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] a citation wrapped inside a blockquote does not leak the '>' marker into the title", async () => {
  // Regression: exaix-dev-docs/dev/Exaix_Edition_Separation_Design.md:438-439 wraps
  // a blockquote citation across two "> "-prefixed lines. Naive space-joining without
  // stripping the marker produced a captured title of `Cost Controls > by Edition`.
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "Exaix_White_Paper.md"), "## Cost Controls by Edition\n\nbody\n");
    await Deno.writeTextFile(
      root + "/x.md",
      '> Compiled from: White Paper §4 "Edition Comparison Matrix" + Exaix_White_Paper.md\n' +
        '> §"Cost Controls by Edition" + §6 compliance.\n',
    );
    const r = await checkDocSectionRefs(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] a citation wrapped inside an indented list continuation does not accumulate extra spaces", async () => {
  // Regression: exaix-dev-docs/dev/Exaix_Edition_Separation_Design.md:1042-1043 wraps
  // a list-item citation across two lines, the second indented two spaces to align
  // under the bullet. Naive joining produced `Cost Controls by   Edition` (3 spaces),
  // which then fails to match the real (single-spaced) heading text.
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "Exaix_White_Paper.md"), "## Cost Controls by Edition\n\nbody\n");
    await Deno.writeTextFile(
      root + "/x.md",
      '- Exaix_White_Paper.md §"Cost Controls by\n' +
        '  Edition", §6 Regulatory Compliance.\n',
    );
    const r = await checkDocSectionRefs(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] a backtick-wrapped filename before the citation still resolves", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "ARCHITECTURE.md"), "## Real Heading\n\nbody\n");
    await Deno.writeTextFile(
      root + "/x.md",
      'See [`ARCHITECTURE.md §"Real Heading"`](./ARCHITECTURE.md) for the canonical test.\n',
    );
    const r = await checkDocSectionRefs(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] a self-reference (no adjacent filename) is checked against its own file", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(
      join(root, "SKILL.md"),
      '## Assertion Sensitivity\n\nbreak the thing it names, confirm it goes red (§"Assertion Sensitivity").\n',
    );
    const r = await checkDocSectionRefs(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] a self-reference to a title that does not exist in the SAME file is flagged", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(
      join(root, "SKILL.md"),
      '## Assertion Sensitivity\n\nsee §"Edge Case Coverage" for the dimensions.\n',
    );
    const r = await checkDocSectionRefs(root);
    assertEquals(r.ok, false);
    assertEquals(r.violations.length, 1);
    assertEquals(r.violations[0].targetFile, "SKILL.md");
    assertEquals(r.violations[0].file, r.violations[0].targetFile);
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] an unquoted §-citation is never validated (no reliable text boundary)", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "ARCHITECTURE.md"), "## Real Heading\n\nbody\n");
    await Deno.writeTextFile(
      root + "/x.md",
      "See ARCHITECTURE.md § Nonexistent Section Name for the full provider list.\n",
    );
    const r = await checkDocSectionRefs(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] a numbered §-citation (§2, §F) is never validated", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(
      join(root, "SKILL.md"),
      "See CODE_STYLE.md §2 for magic-value rules and §F for the template.\n",
    );
    const r = await checkDocSectionRefs(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] a citation whose target FILE does not resolve is reported distinctly", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(root + "/x.md", 'See MISSING.md §"Some Heading" for details.\n');
    const r = await checkDocSectionRefs(root);
    assertEquals(r.ok, false);
    assertEquals(r.violations.length, 1);
    assertEquals(r.violations[0].targetFile, "MISSING.md");
    assertEquals(r.violations[0].headingFound, false);
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] a citation inside a fenced code block is not scanned", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "ARCHITECTURE.md"), "## Real Heading\n\nbody\n");
    await Deno.writeTextFile(
      root + "/x.md",
      '```text\nARCHITECTURE.md §"Totally Made Up Section"\n```\n',
    );
    const r = await checkDocSectionRefs(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] matching is case-insensitive and tolerant of markdown emphasis on the heading", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await Deno.writeTextFile(join(root, "ARCHITECTURE.md"), "## **Loud Heading**\n\nbody\n");
    await Deno.writeTextFile(root + "/x.md", 'See ARCHITECTURE.md §"loud heading" for details.\n');
    const r = await checkDocSectionRefs(root);
    assertEquals(r.violations.length, 0, JSON.stringify(r.violations));
  } finally {
    cleanup();
  }
});

Deno.test("[section-refs] --staged restricts violations to the given file set", async () => {
  const { root, cleanup } = await sandbox();
  try {
    await ensureDir(join(root, "sub"));
    await Deno.writeTextFile(join(root, "ARCHITECTURE.md"), "## Real Heading\n\nbody\n");
    await Deno.writeTextFile(root + "/touched.md", 'See ARCHITECTURE.md §"Nonexistent" here.\n');
    await Deno.writeTextFile(root + "/untouched.md", 'See ARCHITECTURE.md §"Also Nonexistent" here.\n');
    const r = await checkDocSectionRefs(root, { onlyFiles: new Set(["touched.md"]) });
    assertEquals(r.violations.length, 1);
    assertEquals(r.violations[0].file, "touched.md");
  } finally {
    cleanup();
  }
});
