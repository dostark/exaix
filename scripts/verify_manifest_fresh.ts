#!/usr/bin/env -S deno run -A
/**
 * @module VerifyManifestFresh
 * @path scripts/verify_manifest_fresh.ts
 * @description Checks if the agent manifest is up to date with the current .copilot/ folder state.
 *
 * Usage:
 *   deno run -A scripts/verify_manifest_fresh.ts
 */
import { generateManifestObject } from "./build_agents_index.ts";

type ManifestValue = string | number | boolean | null | undefined | ManifestValue[] | { [key: string]: ManifestValue };

interface IManifestDocLike {
  path?: string;
  chunks?: string[];
  [key: string]: ManifestValue;
}

interface IManifestLike {
  generated_at?: string;
  docs?: IManifestDocLike[];
  [key: string]: ManifestValue;
}

function normalize(obj: IManifestLike): IManifestLike {
  // remove generated_at and sort docs by path for deterministic comparison
  const copy = JSON.parse(JSON.stringify(obj)) as IManifestLike;
  delete copy.generated_at;
  if (Array.isArray(copy.docs)) {
    copy.docs.sort((a, b) => String(a.path).localeCompare(String(b.path)));
    for (const d of copy.docs) {
      if (Array.isArray(d.chunks)) d.chunks.sort();
    }
  }
  return copy;
}

async function main() {
  const generated = await generateManifestObject();
  let existingText = "";
  try {
    existingText = await Deno.readTextFile(".copilot/manifest.json");
  } catch (_e) {
    console.error("Existing manifest.json not found: .copilot/manifest.json");
    Deno.exit(2);
  }
  const existing = JSON.parse(existingText);

  const a = normalize(generated);
  const b = normalize(existing);

  const sa = JSON.stringify(a, null, 2);
  const sb = JSON.stringify(b, null, 2);

  if (sa !== sb) {
    console.error(
      ".copilot/manifest.json is out of date with current .copilot/ sources. Run scripts/build_agents_index.ts and commit the updated manifest.",
    );
    Deno.exit(1);
  }

  console.log(".copilot/manifest.json is up-to-date.");
}

if (import.meta.main) await main();

export {};
