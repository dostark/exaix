/**
 * @module ContainerProfileSecurityTest
 * @path tests/security/container_profile_security_test.ts
 * @related-files []
 * @architectural-layer Tests
 * @description Security regression for Finding 17. The sandbox Compose profile must build the
 *   hardened `runtime` stage, not the last Dockerfile stage. That runtime stage must copy every
 *   workspace member that deno.json names, so the daemon config loads inside the image.
 */

import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/yaml";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const RUNTIME_STAGE = "runtime";
const STAGE_PATTERN = /^FROM\s+\S+\s+AS\s+(\S+)/i;

interface IComposeFile {
  services: Record<string, { build?: { target?: string } }>;
}

/** Splits the Dockerfile into named stages, each with its own instruction lines. */
async function readDockerfileStages(): Promise<Map<string, string[]>> {
  const stages = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of (await Deno.readTextFile(join(REPO_ROOT, "Dockerfile"))).split("\n")) {
    const match = line.match(STAGE_PATTERN);
    if (match) {
      current = [];
      stages.set(match[1], current);
      continue;
    }
    current?.push(line);
  }
  return stages;
}

Deno.test("[security] the sandbox Compose profile builds the runtime stage explicitly", async () => {
  const compose = parse(await Deno.readTextFile(join(REPO_ROOT, "compose.sandbox.yaml"))) as IComposeFile;
  assertEquals(compose.services.exaix.build?.target, RUNTIME_STAGE);

  const stageNames = [...(await readDockerfileStages()).keys()];
  assert(stageNames.includes(RUNTIME_STAGE), "the Dockerfile must define the runtime stage");
});

Deno.test("[security] the runtime stage copies every deno.json workspace member root", async () => {
  const denoJson = JSON.parse(await Deno.readTextFile(join(REPO_ROOT, "deno.json"))) as { workspace: string[] };
  const runtime = (await readDockerfileStages()).get(RUNTIME_STAGE) ?? [];
  const copied = runtime
    .filter((line) => line.trim().startsWith("COPY") && !line.includes("--from="))
    .flatMap((line) => line.trim().split(/\s+/).slice(1, -1))
    .filter((token) => !token.startsWith("--"))
    .map((token) => token.replace(/\/$/, ""));

  for (const member of denoJson.workspace) {
    const topLevel = member.replace(/^\.\//, "").split("/")[0];
    assert(copied.includes(topLevel), `runtime stage does not copy workspace root '${topLevel}/'`);
  }
});
