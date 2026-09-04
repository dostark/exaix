/**
 * @module FlowIdFilenameAgreementTest
 * @path tests/blueprints/flow_id_filename_agreement_test.ts
 * @description Phase 142 Step 13 — every flow blueprint's declared `id` must equal its
 *   filename, because `FlowLoader.loadFlow` resolves `<id>.flow.yaml` and then rejects the
 *   file if the two disagree.
 *
 *   13 of the 16 shipped flows violated this: the files were snake_case while the ids inside
 *   them were kebab-case, so those flows could not be loaded at all and every request naming
 *   one failed. It went unnoticed because `RequestProcessor` never called the loader — it cast
 *   `{ id } as IFlow` instead, which crashed later inside FlowRunner on `steps.length` with no
 *   indication that a catalog defect was the cause.
 * @architectural-layer Test
 * @related-files [packages/flow/src/flow_loader.ts, packages/request/src/processor.ts]
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const FLOWS_DIR = join(REPO_ROOT, "Blueprints", "Flows");

interface IFlowFile {
  filename: string;
  declaredId: string | null;
}

async function readFlowFiles(): Promise<IFlowFile[]> {
  const files: IFlowFile[] = [];
  for await (const entry of Deno.readDir(FLOWS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".flow.yaml")) continue;
    const text = await Deno.readTextFile(join(FLOWS_DIR, entry.name));
    const match = text.match(/^id:\s*"?([^"\n]+)"?/m);
    files.push({
      filename: entry.name.replace(/\.flow\.yaml$/, ""),
      declaredId: match ? match[1].trim() : null,
    });
  }
  files.sort((a, b) => a.filename.localeCompare(b.filename));
  return files;
}

Deno.test("[flow-catalog] every flow's declared id equals its filename", async () => {
  const mismatched = (await readFlowFiles())
    .filter((flow) => flow.declaredId !== flow.filename)
    .map((flow) => `${flow.filename}.flow.yaml declares id '${flow.declaredId}'`);
  assertEquals(
    mismatched,
    [],
    `FlowLoader resolves <id>.flow.yaml and rejects a file whose id disagrees, so these flows ` +
      `cannot be loaded at all:\n${mismatched.join("\n")}`,
  );
});

Deno.test("[flow-catalog] every flow declares an id", async () => {
  const missing = (await readFlowFiles()).filter((flow) => flow.declaredId === null).map((flow) => flow.filename);
  assertEquals(missing, [], `flow blueprints with no id: ${missing.join(", ")}`);
});

Deno.test("[flow-catalog] flow ids are kebab-case, matching every other artefact id", async () => {
  // Agent roles and skills are kebab-case throughout (senior-coder, tdd-methodology). The
  // snake_case flow filenames were the outlier, which is why the rename went that direction.
  const offenders = (await readFlowFiles())
    .filter((flow) => flow.declaredId !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(flow.declaredId))
    .map((flow) => flow.declaredId);
  assertEquals(offenders, [], `flow ids that are not kebab-case: ${offenders.join(", ")}`);
});
