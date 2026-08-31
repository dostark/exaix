/**
 * @module ContextCardTest
 * @path packages/core/tests/context/context_card_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Verifies the generation and discovery of portal "Context Cards",
 * ensuring that core portal identity and mission are correctly summarized.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ContextCardGenerator } from "@exaix/core/context";
import { ExaPathDefaults } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { createMockConfig } from "@exaix/testing";
import { initTestDbService } from "@exaix/testing";

Deno.test("ContextCardGenerator: creates new card", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "card-test-new-" });
  try {
    const config = createMockConfig(tempDir);
    // Ensure Memory/Projects exists (scaffold usually does this, but we are mocking)
    await Deno.mkdir(join(tempDir, ExaPathDefaults.memoryProjects), { recursive: true });

    const generator = new ContextCardGenerator(config);
    await generator.generate({
      alias: "MyApp",
      path: "/home/user/code/myapp",
      techStack: ["TypeScript", "Deno"],
    });

    const cardPath = join(tempDir, ExaPathDefaults.memoryProjects, "MyApp", "portal.md");
    const content = await Deno.readTextFile(cardPath);

    assertExists(content.match(/# Portal: MyApp/));
    assertExists(content.match(/- \*\*Path\*\*: `\/home\/user\/code\/myapp`/));
    assertExists(content.match(/- \*\*Tech Stack\*\*: TypeScript, Deno/));
    assertExists(content.match(/## User Notes/));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ContextCardGenerator: updates card preserving notes", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "card-test-update-" });
  try {
    const config = createMockConfig(tempDir);
    const projectsDir = join(tempDir, ExaPathDefaults.memoryProjects);
    await Deno.mkdir(projectsDir, { recursive: true });

    // Create existing card with user notes
    const initialContent = `# Portal: MyApp
- **Path**: \`/old/path\`
- **Tech Stack**: OldStack

## User Notes

These are my custom notes.
They should be preserved.
`;
    await Deno.mkdir(join(projectsDir, "MyApp"), { recursive: true });
    await Deno.writeTextFile(join(projectsDir, "MyApp", "portal.md"), initialContent);

    const generator = new ContextCardGenerator(config);
    await generator.generate({
      alias: "MyApp",
      path: "/new/path",
      techStack: ["NewStack"],
    });

    const content = await Deno.readTextFile(join(projectsDir, "MyApp", "portal.md"));

    // Check updates
    assertExists(content.match(/- \*\*Path\*\*: `\/new\/path`/));
    assertExists(content.match(/- \*\*Tech Stack\*\*: NewStack/));

    // Check preservation
    assertExists(content.match(/These are my custom notes\./));
    assertExists(content.match(/They should be preserved\./));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ContextCardGenerator: sanitizes alias", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "card-test-sanitize-" });
  try {
    const config = createMockConfig(tempDir);
    await Deno.mkdir(join(tempDir, ExaPathDefaults.memoryProjects), { recursive: true });

    const generator = new ContextCardGenerator(config);
    await generator.generate({
      alias: "My Cool App!",
      path: "/path",
      techStack: [],
    });

    const entries = [];
    for await (const entry of Deno.readDir(join(tempDir, ExaPathDefaults.memoryProjects))) {
      entries.push(entry.name);
    }

    // We expect one file.
    assertEquals(entries.length, 1);
    // We expect it to be safe.
    const filename = entries[0];
    assertEquals(filename.includes(" "), false);
    assertEquals(filename.includes("!"), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ContextCardGenerator: logs activity", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const config = createMockConfig(tempDir);
    await Deno.mkdir(join(tempDir, ExaPathDefaults.memoryProjects), { recursive: true });

    const generator = new ContextCardGenerator(config, new EventLogger({ db }));
    await generator.generate({
      alias: "LoggedApp",
      path: "/path",
      techStack: ["LogStack"],
    });

    // Allow time for batched write to flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify log
    const rows = db.getActivitiesByActionType("context_card.created");
    assertEquals(rows.length, 1);
    const row = rows[0];
    assertEquals(row.actor, "system");
    assertEquals(row.target, "LoggedApp");

    const payload = JSON.parse(row.payload);
    assertEquals(payload.alias, "LoggedApp");
    assertEquals(payload.tech_stack[0], "LogStack");
  } finally {
    await cleanup();
  }
});
