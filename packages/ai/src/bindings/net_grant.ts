/**
 * @module NetGrant
 * @path packages/ai/src/bindings/net_grant.ts
 * @description Computes the daemon's start-time network grant. With an explicit
 *   `[system].allow_net` (including `[]`) the explicit grant is preserved unchanged. With it
 *   unset, every catalog endpoint host (built-in, config and `.exa/overlays/` as they are at
 *   start) joins `DAEMON_DEFAULT_NET_HOSTS`, de-duplicated and sorted. Catalog endpoint URLs
 *   are validated before spawn, so an invalid scheme/userinfo/query/fragment is rejected ahead
 *   of time.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas, @exaix/core]
 * @related-files [apps/exactl/src/commands/daemon_commands.ts, apps/daemon/main.ts]
 */

import { join } from "@std/path";
import type { Config } from "@exaix/schemas/config.ts";
import { DAEMON_DEFAULT_NET_HOSTS } from "@exaix/core";
import { BindingOverlaySchema, type IBindingCatalog } from "@exaix/schemas";
import { BINDING_OVERLAY_MAX_BYTES, BINDING_OVERLAYS_DIR } from "@exaix/core";
import { buildBuiltInCatalog, mergeCatalogs } from "@exaix/model-registry";

/** Raised for any invalid operator overlay or catalog endpoint during grant computation. */
export class NetGrantError extends Error {
  constructor(detail: string) {
    super(`net_grant: ${detail}`);
    this.name = "NetGrantError";
  }
}

/** URL scheme constants for endpoint validation. */
const SCHEME_HTTPS = "https:";
const SCHEME_HTTP = "http:";

/** Normalized canonical host (IPv6-bracketed) with the effective port, if any. */
function canonicalHostPort(parsed: URL): string {
  const host = parsed.hostname.includes(":") ? `[${parsed.hostname}]` : parsed.hostname;
  const port = parsed.port ? `:${parsed.port}` : "";
  return `${host}${port}`;
}

/** True when http(s) and carries no userinfo/query/fragment. */
function validEndpoint(parsed: URL): boolean {
  if (parsed.protocol !== SCHEME_HTTPS && parsed.protocol !== SCHEME_HTTP) return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.search !== "" || parsed.hash !== "") return false;
  return true;
}

/** Parse and validate one endpoint, returning its canonical host:port or throwing. */
function endpointGrantEntry(endpoint: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new NetGrantError(`invalid catalog endpoint: ${endpoint}`);
  }
  if (!validEndpoint(parsed)) {
    throw new NetGrantError(`invalid catalog endpoint (scheme/userinfo/query/fragment): ${endpoint}`);
  }
  return canonicalHostPort(parsed);
}

/** Collect the canonical host:port of every catalog service endpoint.
 *  An endpoint that still holds a sentinel is skipped, which leaves its host ungranted and fails closed. */
function catalogEndpointHosts(catalog: IBindingCatalog): string[] {
  const entries: string[] = [];
  for (const service of Object.values(catalog.services)) {
    if (!service.endpoint) continue;
    if (parseEndpointUrl(service.endpoint) === undefined) continue;
    entries.push(endpointGrantEntry(service.endpoint));
  }
  return entries;
}

/** Parses a catalog endpoint, or returns undefined when it is not yet a URL. */
function parseEndpointUrl(endpoint: string): URL | undefined {
  try {
    return new URL(endpoint);
  } catch {
    return undefined;
  }
}

/** Merge catalog services from every operator overlay file beneath .exa/overlays/. */
async function overlayCatalog(config: Config): Promise<Partial<IBindingCatalog>> {
  let merged: Partial<IBindingCatalog> = {};
  const overlaysDir = join(config.system.root, config.paths.runtime, BINDING_OVERLAYS_DIR);
  let isDir = false;
  try {
    isDir = (await Deno.stat(overlaysDir)).isDirectory;
  } catch {
    return merged;
  }
  if (!isDir) return merged;
  const names: string[] = [];
  for await (const entry of Deno.readDir(overlaysDir)) {
    if (!entry.name.endsWith(".json") && !entry.name.endsWith(".toml")) continue;
    names.push(entry.name);
  }
  names.sort();
  for (const name of names) {
    const path = join(overlaysDir, name);
    let info;
    try {
      info = await Deno.lstat(path);
    } catch {
      throw new NetGrantError(`overlay_invalid: ${name} is not a regular file`);
    }
    if (!info.isFile || info.isSymlink) {
      throw new NetGrantError(`overlay_invalid: ${name} is not a regular file`);
    }
    if (info.size > BINDING_OVERLAY_MAX_BYTES) {
      throw new NetGrantError(`overlay_invalid: ${name} exceeds the byte ceiling`);
    }
    const raw = await Deno.readTextFile(path);
    const parsed = JSON.parse(raw);
    const overlay = BindingOverlaySchema.parse(parsed);
    if (overlay.catalog) merged = mergeCatalogs({ models: {}, services: {}, preferences: {} }, merged, overlay.catalog);
  }
  return merged;
}

/** Compute the daemon's start-time `--allow-net` grant. */
export async function computeStartNetGrant(config: Config): Promise<readonly string[]> {
  const allowNet = config.system.allow_net;
  if (allowNet !== undefined) return allowNet;

  const builtin = buildBuiltInCatalog();
  const configCatalog = config.catalog ?? {};
  const overlays = await overlayCatalog(config);
  const all = mergeCatalogs(builtin, configCatalog, overlays);

  const hosts = new Set<string>([
    ...DAEMON_DEFAULT_NET_HOSTS,
    ...catalogEndpointHosts(all),
  ]);
  return [...hosts].sort();
}
