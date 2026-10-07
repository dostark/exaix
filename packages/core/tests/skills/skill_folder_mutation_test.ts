/**
 * @module SkillFolderMutationTest
 * @path packages/core/tests/skills/skill_folder_mutation_test.ts
 * @description Fault injection at every publication boundary. A fault at any stage of a create, update
 *   or delete leaves either the complete old folder or the complete new one after recovery, never a mix,
 *   and no intent, staging or backup remains. Readers racing a stream of updates only ever see a
 *   complete revision, and two real processes creating one name yield exactly one winner.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/tool-runtime, @exaix/testing]
 * @related-files [packages/core/src/skills/skill_folder_publisher.ts, packages/core/src/skills/skills.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createPathSecurity } from "@exaix/tool-runtime";
import { SkillMutationErrorCode, SkillPublicationStage, SkillStatus } from "@exaix/core";
import {
  createSkillOperationContext,
  type ISkillRevisionSnapshot,
  SkillFolderPublisher,
  SkillMutationError,
  SkillsService,
} from "@exaix/core/skills";
import { initTestDbService, REPO_ROOT } from "@exaix/testing";

const NAME = "fault-skill";

function snap(body: string): ISkillRevisionSnapshot {
  return {
    skill_md: `---\nname: ${NAME}\ndescription: Fault test skill\n---\n${body}\n`,
    exaix_yaml: "status: draft\n",
    references: [{ path: "references/notes.md", content: `notes for ${body}` }],
  };
}

type Operation = "create" | "replace" | "remove";

const EXPECTED_STAGES: Record<Operation, SkillPublicationStage[]> = {
  create: [
    SkillPublicationStage.STAGE_MAIN,
    SkillPublicationStage.STAGE_SIDECAR,
    SkillPublicationStage.INTENT_SYNC,
    SkillPublicationStage.STAGE_TO_DESTINATION,
    SkillPublicationStage.CLEANUP,
  ],
  replace: [
    SkillPublicationStage.STAGE_MAIN,
    SkillPublicationStage.STAGE_SIDECAR,
    SkillPublicationStage.INTENT_SYNC,
    SkillPublicationStage.OLD_TO_BACKUP,
    SkillPublicationStage.STAGE_TO_DESTINATION,
    SkillPublicationStage.CLEANUP,
  ],
  remove: [SkillPublicationStage.INTENT_SYNC, SkillPublicationStage.OLD_TO_BACKUP, SkillPublicationStage.CLEANUP],
};

class InjectedFault extends Error {}

async function entries(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(dir)) out.push(entry.name);
  return out;
}

async function run(
  publisher: SkillFolderPublisher,
  root: string,
  operation: Operation,
): Promise<void> {
  if (operation === "create") await publisher.create(root, NAME, snap("new"));
  else if (operation === "replace") await publisher.replace(root, NAME, snap("new"));
  else await publisher.remove(root, NAME);
}

for (const operation of Object.keys(EXPECTED_STAGES) as Operation[]) {
  Deno.test(`[fault] ${operation} reports its stages in order`, async () => {
    const root = await Deno.makeTempDir({ prefix: "exa-skill-fault-" });
    try {
      const fired: SkillPublicationStage[] = [];
      const publisher = new SkillFolderPublisher(createPathSecurity(), 500, (stage) => {
        fired.push(stage);
      });
      await publisher.ensureState(root);
      if (operation !== "create") await publisher.create(root, NAME, snap("old"));
      fired.length = 0;
      await run(publisher, root, operation);
      assertEquals(fired, EXPECTED_STAGES[operation]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  for (const stage of EXPECTED_STAGES[operation]) {
    Deno.test(`[fault] ${operation} faulting at ${stage} recovers to a complete old or new folder`, async () => {
      const root = await Deno.makeTempDir({ prefix: "exa-skill-fault-" });
      try {
        let armed = false;
        const crashing = new SkillFolderPublisher(createPathSecurity(), 500, (reached) => {
          if (armed && reached === stage) throw new InjectedFault(stage);
        });
        await crashing.ensureState(root);
        if (operation !== "create") await crashing.create(root, NAME, snap("old"));
        armed = true;
        await assertRejects(() => run(crashing, root, operation), InjectedFault);

        await new SkillFolderPublisher(createPathSecurity(), 500).recover(root);

        const folder = join(root, NAME);
        const present = await Deno.lstat(folder).then(() => true, () => false);
        if (present) {
          const body = await Deno.readTextFile(join(folder, "SKILL.md"));
          const references = await Deno.readTextFile(join(folder, "references", "notes.md"));
          const isOld = body.includes("old") && references === "notes for old";
          const isNew = body.includes("new") && references === "notes for new";
          assert(isOld || isNew, `mixed folder after ${operation} fault at ${stage}`);
          assertEquals(await Deno.readTextFile(join(folder, "exaix.yaml")), "status: draft\n");
          if (operation === "remove") assert(isOld, "a delete never leaves a changed folder");
          if (operation === "create") assert(isNew, "a create never leaves a changed folder");
        } else {
          assert(operation !== "replace", "an update never loses the folder");
        }
        for (const kind of ["intents", "staging", "backup"]) {
          assertEquals(await entries(join(root, ".exa-skill-state", kind)), [], `${kind} left behind`);
        }
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });
  }
}

Deno.test("[fault] readers racing a stream of updates only ever see a complete revision", async () => {
  const env = await initTestDbService();
  const memoryDir = await Deno.makeTempDir({ prefix: "exa-skill-race-" });
  try {
    const service = new SkillsService({ memoryDir }, env.db);
    await service.initialize();
    const ctx = createSkillOperationContext({ agentRole: "test" });
    await service.createSkill({ name: NAME, description: "Race skill", instructions: "Body 0." }, ctx);
    let draft = await service.getSkill(NAME, ctx);
    assertEquals(draft, null, "a new draft is not active");
    const seen = new Set<string>();
    let running = true;
    const reader = (async () => {
      while (running) {
        const all = await service.listSkills({ status: SkillStatus.DRAFT }, ctx);
        const skill = all.find((candidate) => candidate.name === NAME);
        assert(skill, "the skill must never disappear while it is updated");
        seen.add(skill.instructions);
      }
    })();
    for (let index = 1; index <= 12; index += 1) {
      await service.updateSkill(NAME, { instructions: `Body ${index}.` }, ctx);
    }
    running = false;
    await reader;
    draft = (await service.listSkills({ status: SkillStatus.DRAFT }, ctx)).find((skill) => skill.name === NAME) ?? null;
    assertEquals(draft?.instructions, "Body 12.");
    for (const body of seen) assert(/^Body \d+\.$/.test(body), `partial body observed: ${body}`);
  } finally {
    await env.cleanup();
    await Deno.remove(memoryDir, { recursive: true });
  }
});

const CREATE_SCRIPT = `
import { SkillsService, createSkillOperationContext } from "@exaix/core/skills";
import { DatabaseService } from "@exaix/storage-sqlite";
const [memoryDir, dbRoot, label] = Deno.args;
const service = new SkillsService({ memoryDir }, undefined as never);
const ctx = createSkillOperationContext({ agentRole: "child-" + label });
try {
  await service.createSkill({ name: "${NAME}", description: "Cross process", instructions: "Made by " + label }, ctx);
  console.log("created");
} catch (error) {
  console.log(error && error.code ? error.code : "failed");
}
void DatabaseService; void dbRoot;
`;

Deno.test("[fault] two real processes creating one name yield exactly one winner and one name conflict", async () => {
  const memoryDir = await Deno.makeTempDir({ prefix: "exa-skill-xproc-" });
  const scriptPath = join(memoryDir, "create_child.ts");
  try {
    await Deno.writeTextFile(scriptPath, CREATE_SCRIPT);
    const children = ["a", "b"].map((label) =>
      new Deno.Command("deno", {
        args: ["run", "--allow-all", "--config", join(REPO_ROOT, "deno.json"), scriptPath, memoryDir, memoryDir, label],
        stdout: "piped",
        stderr: "piped",
      }).output()
    );
    const outputs = (await Promise.all(children)).map((result) => new TextDecoder().decode(result.stdout).trim());
    assertEquals([...outputs].sort(), ["created", SkillMutationErrorCode.NAME_CONFLICT].sort());
    const body = await Deno.readTextFile(join(memoryDir, "Skills", "learned", NAME, "SKILL.md"));
    assert(/Made by [ab]/.test(body));
  } finally {
    await Deno.remove(memoryDir, { recursive: true });
  }
});

Deno.test("[fault] a name conflict surfaces as a typed mutation error", async () => {
  const root = await Deno.makeTempDir({ prefix: "exa-skill-fault-" });
  try {
    const publisher = new SkillFolderPublisher(createPathSecurity(), 500);
    await publisher.ensureState(root);
    await publisher.create(root, NAME, snap("old"));
    const error = await assertRejects(() => publisher.create(root, NAME, snap("new")), SkillMutationError);
    assertEquals(error.code, SkillMutationErrorCode.NAME_CONFLICT);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
