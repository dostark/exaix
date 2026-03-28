/**
 * @module ProjectScaffoldTest
 * @path tests/scaffold_test.ts
 * @description Verifies the logic of the project initialization script, ensuring correct
 * creation of the required directory structure, config templates, and baseline assets.
 */

import { assert, assertStringIncludes } from "https://deno.land/std@0.201.0/testing/asserts.ts";
import { dirname, fromFileUrl, join } from "https://deno.land/std@0.201.0/path/mod.ts";
import { exists } from "https://deno.land/std@0.201.0/fs/mod.ts";
import { ExaPathDefaults } from "../../src/shared/constants.ts";

const __dirname = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

// Helper to run scaffold.sh with given args
async function runScaffold(
  target: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const scriptPath = join(REPO_ROOT, "scripts", "scaffold.sh");
  const cmd = new Deno.Command("bash", {
    args: [scriptPath, target],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });

  const res = await cmd.output();
  return {
    code: res.code,
    stdout: new TextDecoder().decode(res.stdout),
    stderr: new TextDecoder().decode(res.stderr),
  };
}

Deno.test("scaffold.sh creates required directory structure", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-scaffold-test-" });
  try {
    const result = await runScaffold(tmp);

    if (result.code !== 0) {
      console.error("scaffold failed stdout:", result.stdout);
      console.error("scaffold failed stderr:", result.stderr);
    }

    assert(result.code === 0, `scaffold.sh exited with code ${result.code}`);

    // Verify all required directories exist
    const requiredDirs = [
      ExaPathDefaults.runtime,
      join(ExaPathDefaults.blueprints, ExaPathDefaults.identities),
      ExaPathDefaults.flows,
      join(ExaPathDefaults.workspace, ExaPathDefaults.requests),
      join(ExaPathDefaults.workspace, ExaPathDefaults.plans),
      ExaPathDefaults.memoryProjects,
      ExaPathDefaults.memoryExecution,
      ExaPathDefaults.memoryIndex,
      ExaPathDefaults.portals,
      "scripts",
    ];

    for (const dir of requiredDirs) {
      const dirPath = join(tmp, dir);
      assert(
        await exists(dirPath),
        `Required directory ${dir} should exist`,
      );
    }
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("scaffold.sh creates .gitkeep files", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-scaffold-test-" });
  try {
    const result = await runScaffold(tmp);
    assert(result.code === 0, `scaffold.sh failed: ${result.stderr}`);

    // Verify .gitkeep files exist
    const gitkeepPaths = [
      join(ExaPathDefaults.runtime, ".gitkeep"),
      join(ExaPathDefaults.blueprints, ExaPathDefaults.identities, ".gitkeep"),
      join(ExaPathDefaults.flows, ".gitkeep"),
      join(ExaPathDefaults.workspace, ExaPathDefaults.requests, ".gitkeep"),
      join(ExaPathDefaults.workspace, ExaPathDefaults.plans, ".gitkeep"),
      join(ExaPathDefaults.memory, ".gitkeep"),
      join(ExaPathDefaults.memoryIndex, ".gitkeep"),
      join(ExaPathDefaults.portals, ".gitkeep"),
    ];

    for (const path of gitkeepPaths) {
      const fullPath = join(tmp, path);
      assert(
        await exists(fullPath),
        `.gitkeep should exist at ${path}`,
      );
    }
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("scaffold.sh copies exa.config.sample.toml template", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-scaffold-test-" });
  try {
    const result = await runScaffold(tmp);
    assert(result.code === 0, `scaffold.sh failed: ${result.stderr}`);
    assertStringIncludes(result.stdout, "Copied exa.config.sample.toml");

    const configPath = join(tmp, "exa.config.sample.toml");
    assert(
      await exists(configPath),
      "exa.config.sample.toml should be copied",
    );

    // Verify it has expected content
    const content = await Deno.readTextFile(configPath);
    assertStringIncludes(content, "[paths]");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("scaffold.sh does not create src directory", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-scaffold-test-" });
  try {
    const result = await runScaffold(tmp);
    assert(result.code === 0, `scaffold.sh failed: ${result.stderr}`);

    const srcPath = join(tmp, "src");
    assert(
      !await exists(srcPath),
      "src directory should NOT be created by scaffold",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("scaffold.sh creates Memory/Projects directory and README placeholder", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-scaffold-test-" });
  try {
    const result = await runScaffold(tmp);
    assert(result.code === 0, `scaffold.sh failed: ${result.stderr}`);

    const projectsPath = join(tmp, ExaPathDefaults.memoryProjects);
    assert(
      await exists(projectsPath),
      "Memory/Projects should be created",
    );

    // Verify the scaffold created a README template at top-level
    const readmePath = join(tmp, "README.md");
    assert(
      await exists(readmePath),
      "Top-level README.md should be copied",
    );

    const content = await Deno.readTextFile(readmePath);
    assert(content.length > 0, "README.md should not be empty");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("scaffold.sh does not overwrite existing config file", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-scaffold-test-" });
  try {
    // Create an existing config file
    const existingContent = "# My existing config\n[custom]\nvalue = 123\n";
    await Deno.writeTextFile(join(tmp, "exa.config.sample.toml"), existingContent);

    const result = await runScaffold(tmp);
    assert(result.code === 0, `scaffold.sh failed: ${result.stderr}`);

    // Verify the existing file was not overwritten
    const content = await Deno.readTextFile(join(tmp, "exa.config.sample.toml"));
    assertStringIncludes(content, "# My existing config");
    assertStringIncludes(content, "[custom]");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

// Test removed: src/main.ts template no longer exists

Deno.test("scaffold.sh is idempotent", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-scaffold-test-" });
  try {
    // Run scaffold twice
    const result1 = await runScaffold(tmp);
    assert(result1.code === 0, `First scaffold failed: ${result1.stderr}`);

    const result2 = await runScaffold(tmp);
    assert(result2.code === 0, `Second scaffold failed: ${result2.stderr}`);

    // Verify structure is still correct
    const requiredDirs = [
      ".exa",
      "Blueprints/Identities",
      "Workspace/Requests",
      "Memory/Reports",
      "Portals",
    ];

    for (const dir of requiredDirs) {
      assert(
        await exists(join(tmp, dir)),
        `Directory ${dir} should still exist after second run`,
      );
    }
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("scaffold.sh outputs completion message", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-scaffold-test-" });
  try {
    const result = await runScaffold(tmp);
    assert(result.code === 0, `scaffold.sh failed: ${result.stderr}`);

    assertStringIncludes(result.stdout, "Scaffold complete");
    assertStringIncludes(result.stdout, "deno task cache");
    assertStringIncludes(result.stdout, "deno task setup");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("scaffold.sh uses current directory if no target provided", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-scaffold-test-" });
  try {
    // Run scaffold without target argument (from tmp directory)
    const scriptPath = join(REPO_ROOT, "scripts", "scaffold.sh");
    const cmd = new Deno.Command("bash", {
      args: [scriptPath],
      cwd: tmp, // Run from tmp directory
      stdout: "piped",
      stderr: "piped",
    });

    const res = await cmd.output();
    const result = {
      code: res.code,
      stdout: new TextDecoder().decode(res.stdout),
      stderr: new TextDecoder().decode(res.stderr),
    };

    assert(result.code === 0, `scaffold.sh failed: ${result.stderr}`);

    // Verify structure was created in current directory
    assert(
      await exists(join(tmp, ".exa")),
      ".exa directory should be created in current directory",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});
