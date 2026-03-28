/**
 * @module DeployCommandTest
 * @path tests/deploy_test.ts
 * @description Verifies the logic for project deployment, ensuring correct staging
 * of assets and execution of post-deployment verification hooks.
 */

import { assert, assertFalse } from "https://deno.land/std@0.201.0/testing/asserts.ts";
import { dirname, fromFileUrl, join } from "https://deno.land/std@0.201.0/path/mod.ts";
import { exists } from "https://deno.land/std@0.201.0/fs/mod.ts";

const __dirname = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

async function runDeploy(target: string) {
  const scriptPath = join(REPO_ROOT, "scripts", "deploy_workspace.sh");
  const cmd = new Deno.Command("bash", {
    args: [scriptPath, "--no-run", target],
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

Deno.test("deploy_workspace.sh copies Memory, Blueprints, and not docs subfolders", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "exaix-deploy-test-" });
  try {
    const result = await runDeploy(tmp);
    if (result.code !== 0) {
      console.error("deploy failed stdout:", result.stdout);
      console.error("deploy failed stderr:", result.stderr);
    }
    assert(result.code === 0, `deploy exited with ${result.code}`);

    // Memory should be copied (check for index or projects .gitkeep)
    const memIndex = join(tmp, "Memory", "Index", ".gitkeep");
    const memProjects = join(tmp, "Memory", "Projects", ".gitkeep");
    const memExists = await exists(memIndex) || await exists(memProjects);
    assert(memExists, "Memory content should be copied to deployed workspace");

    // Blueprints should be copied (expect at least a README or identity file)
    const blueprintReadme = join(tmp, "Blueprints", "Identities", "README.md");
    assert(await exists(blueprintReadme), "Blueprints content should be copied to deployed workspace");

    // docs/: top-level files only — ensure docs directory exists
    const docsDir = join(tmp, "docs");
    assert(await exists(docsDir), "docs directory should exist in deployed workspace");

    // Ensure subfolders like docs/dev are NOT copied
    const docsDev = join(docsDir, "dev");
    assertFalse(await exists(docsDev), "docs subfolders should NOT be copied into deployed workspace");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});
