/**
 * @module CalibrationContextIdentityTest
 * @path packages/eval-history/tests/calibration_context_identity_test.ts
 * @description Verify assembly policy identity independently of item submission bytes and source ordering.
 * @architectural-layer Test
 * @related-files [packages/eval-history/src/calibration/identity.ts]
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { JSONObject } from "@exaix/core/types";
import {
  buildContextAssemblyIdentity,
  CalibrationCanonicalizationError,
  canonicalJsonStringify,
  ContextAssemblyKind,
  hashCalibrationValue,
  sha256Hex,
} from "../src/calibration/identity.ts";
import type { IContextAssemblyInput } from "../src/calibration/identity.ts";
import { ARTIFACT_CONTEXT_ASSEMBLY_VERSION, JUDGE_CONTEXT_ASSEMBLY_VERSION } from "../src/calibration/constants.ts";

function input(): IContextAssemblyInput {
  return {
    kind: ContextAssemblyKind.Artifact,
    sources: {
      "packages/execution/src/agent_runner.ts": "assemble resolved segments\n",
      "Blueprints/Skills/plan.skill.md": "Use the original request.\n",
    },
    dynamicAssets: ["Blueprints/Skills/plan.skill.md"],
    effectiveConfiguration: { context_budget: 4096, selection: { skills: "resolved" } },
  };
}

Deno.test("context assembly identity sorts exact source inputs and records auditable immutable hashes", async (): Promise<void> => {
  const original: IContextAssemblyInput = input();
  const identity = await buildContextAssemblyIdentity(original);
  const reordered: IContextAssemblyInput = {
    ...original,
    sources: Object.fromEntries(Object.entries(original.sources).reverse()),
  };
  assertEquals(await buildContextAssemblyIdentity(reordered), identity);
  assertEquals(identity.version, ARTIFACT_CONTEXT_ASSEMBLY_VERSION);
  assertEquals(
    identity.input_map.sources["Blueprints/Skills/plan.skill.md"],
    await sha256Hex(original.sources["Blueprints/Skills/plan.skill.md"]),
  );
  assertEquals(
    identity.digest,
    await hashCalibrationValue({
      kind: identity.kind,
      version: identity.version,
      input_map: identity.input_map,
    }),
  );
  assertThrows(() => {
    identity.input_map.configuration.context_budget = 1;
  }, TypeError);
});

Deno.test("context assembly source, dynamic asset and effective configuration changes invalidate identity", async (): Promise<void> => {
  const original = await buildContextAssemblyIdentity(input());
  const changedSource = input();
  changedSource.sources["packages/execution/src/agent_runner.ts"] += "changed budget selection\n";
  const changedAsset = input();
  changedAsset.sources["Blueprints/Skills/plan.skill.md"] += "Cite evidence.\n";
  const changedConfiguration = input();
  changedConfiguration.effectiveConfiguration.context_budget = 8192;
  const changedSelection = input();
  changedSelection.dynamicAssets = [];
  for (const changed of [changedSource, changedAsset, changedConfiguration, changedSelection]) {
    assert((await buildContextAssemblyIdentity(changed)).digest !== original.digest);
  }
});

Deno.test("artifact and judge assemblies have separate versions and item submissions have separate hashes", async (): Promise<void> => {
  const artifact = await buildContextAssemblyIdentity(input());
  const judge = await buildContextAssemblyIdentity({ ...input(), kind: ContextAssemblyKind.Judge });
  assertEquals(judge.version, JUDGE_CONTEXT_ASSEMBLY_VERSION);
  assert(judge.version !== artifact.version);
  assert(judge.digest !== artifact.digest);
  assert(await sha256Hex("request A\nplan A") !== await sha256Hex("request B\nplan B"));
  assertEquals((await buildContextAssemblyIdentity(input())).digest, artifact.digest);
});

Deno.test("[security] assembly input names cannot overwrite the hash map prototype", async (): Promise<void> => {
  const sourceBytes: string = "retained source bytes";
  const identity = await buildContextAssemblyIdentity({
    ...input(),
    sources: Object.fromEntries([["__proto__", sourceBytes]]),
    dynamicAssets: [],
  });
  assertEquals(identity.input_map.sources["__proto__"], await sha256Hex(sourceBytes));
  assertEquals(Object.keys(identity.input_map.sources), ["__proto__"]);
});

Deno.test("[security] context assembly rejects missing dynamic inputs, unsafe paths and secret configuration", async (): Promise<void> => {
  const missing = input();
  missing.dynamicAssets.push("Blueprints/Skills/missing.skill.md");
  await assertRejects(() => buildContextAssemblyIdentity(missing), CalibrationCanonicalizationError);
  for (const path of ["../private", "/home/private", "a/../private", "a\\private"]) {
    await assertRejects(
      () => buildContextAssemblyIdentity({ ...input(), sources: { [path]: "bytes" }, dynamicAssets: [] }),
      CalibrationCanonicalizationError,
    );
  }
  await assertRejects(
    () => buildContextAssemblyIdentity({ ...input(), sources: {}, dynamicAssets: [] }),
    CalibrationCanonicalizationError,
  );
  for (const configuration of [{ auth: { access_token: "PRIVATE_CANARY" } }, { password: "PRIVATE_CANARY" }]) {
    await assertRejects(
      () => buildContextAssemblyIdentity({ ...input(), effectiveConfiguration: configuration }),
      CalibrationCanonicalizationError,
    );
  }
});

Deno.test("[security] canonical identity rejects undefined and nonfinite data rather than silently dropping fields", (): void => {
  const undefinedField: JSONObject = { policy: undefined };
  assertThrows(() => canonicalJsonStringify(undefinedField), CalibrationCanonicalizationError);
  assertThrows(() => canonicalJsonStringify({ value: Number.NaN }), CalibrationCanonicalizationError);
  assertThrows(() => canonicalJsonStringify({ value: Number.POSITIVE_INFINITY }), CalibrationCanonicalizationError);
});
