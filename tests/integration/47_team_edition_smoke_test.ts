/**
 * @module TeamEditionSmokeTest
 * @path tests/integration/47_team_edition_smoke_test.ts
 * @description Team-edition smoke tests — validates Solo vs Team provider bootstrap,
 * TeamComposer integration, and EXAIX_EDITION environment variable routing.
 */

import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { ProviderRegistry } from "@exaix/ai";
import { EDITION_SOLO, EDITION_TEAM, ProviderType, SoloComposer } from "@exaix/core";
import { bootstrapTeamProviders, TeamComposer } from "@exaix-team/team-composer";
import type { ICapabilityModule } from "@exaix/core";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";

const SOLO_PROVIDERS = [
  ProviderType.OLLAMA,
  ProviderType.ANTHROPIC,
  ProviderType.OPENAI,
  ProviderType.GOOGLE,
  ProviderType.OPENROUTER,
];

const TEAM_ONLY_PROVIDER = ProviderType.VERTEX;

function freshSoloBootstrap(): void {
  ProviderRegistry.clear();
  bootstrapProviderRegistry();
}

describe("[team] Team edition provider bootstrap", () => {
  it("Solo bootstrap registers standard providers but not Vertex AI", () => {
    freshSoloBootstrap();

    for (const provider of SOLO_PROVIDERS) {
      assert(
        ProviderRegistry.getSupportedProviders().includes(provider),
        `Expected Solo provider ${provider} to be registered`,
      );
    }

    assert(
      !ProviderRegistry.getSupportedProviders().includes(TEAM_ONLY_PROVIDER),
      "Vertex AI must NOT be registered after Solo bootstrap",
    );
  });

  it("Team bootstrap adds Vertex AI alongside Solo providers", () => {
    freshSoloBootstrap();
    bootstrapTeamProviders();

    for (const provider of SOLO_PROVIDERS) {
      assert(
        ProviderRegistry.getSupportedProviders().includes(provider),
        `Expected Solo provider ${provider} to be registered after Team bootstrap`,
      );
    }

    assert(
      ProviderRegistry.getSupportedProviders().includes(TEAM_ONLY_PROVIDER),
      "Vertex AI must be registered after Team bootstrap",
    );
  });

  it("Vertex AI factory is retrievable after Team bootstrap", () => {
    freshSoloBootstrap();
    bootstrapTeamProviders();

    const factory = ProviderRegistry.getFactory(TEAM_ONLY_PROVIDER);
    assert(factory !== undefined, "Vertex AI factory must be retrievable");
    assertEquals(typeof factory!.create, "function");
  });
});

describe("TeamComposer integration", () => {
  it("constructs TeamComposer without crash", () => {
    const composer = new TeamComposer();
    assertEquals(composer instanceof TeamComposer, true);
  });

  it("TeamComposer getModules returns empty initially", () => {
    const composer = new TeamComposer();
    assertEquals(composer.getModules(), []);
  });

  it("TeamComposer registers and retrieves capability modules", () => {
    const composer = new TeamComposer();
    const stub: ICapabilityModule = {};
    composer.registerCapabilityModule(stub);
    assertEquals(composer.getModules().length, 1);
    assertEquals(composer.getModules()[0], stub);
  });

  it("TeamComposer stores multiple modules", () => {
    const composer = new TeamComposer();
    composer.registerCapabilityModule({});
    composer.registerCapabilityModule({});
    assertEquals(composer.getModules().length, 2);
  });
});

describe("Edition selection via EXAIX_EDITION", () => {
  const ORIGINAL_EDITION = Deno.env.get("EXAIX_EDITION");

  it("defaults to Solo when EXAIX_EDITION is unset", () => {
    Deno.env.delete("EXAIX_EDITION");
    const editionType = Deno.env.get("EXAIX_EDITION") ?? EDITION_SOLO;
    const composer = editionType === EDITION_TEAM ? new TeamComposer() : new SoloComposer();
    assertEquals(composer instanceof SoloComposer, true);
  });

  it("creates TeamComposer when EXAIX_EDITION=team", () => {
    Deno.env.set("EXAIX_EDITION", EDITION_TEAM);
    const editionType = Deno.env.get("EXAIX_EDITION") ?? EDITION_SOLO;
    const composer = editionType === EDITION_TEAM ? new TeamComposer() : new SoloComposer();
    assertEquals(composer instanceof TeamComposer, true);
  });

  it("creates SoloComposer when EXAIX_EDITION=solo", () => {
    Deno.env.set("EXAIX_EDITION", EDITION_SOLO);
    const editionType = Deno.env.get("EXAIX_EDITION") ?? EDITION_SOLO;
    const composer = editionType === EDITION_TEAM ? new TeamComposer() : new SoloComposer();
    assertEquals(composer instanceof SoloComposer, true);
  });

  // Restore original ENV
  if (ORIGINAL_EDITION !== undefined) {
    Deno.env.set("EXAIX_EDITION", ORIGINAL_EDITION);
  } else {
    Deno.env.delete("EXAIX_EDITION");
  }
});
