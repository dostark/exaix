/**
 * @module PortalErrors
 * @path packages/portal/src/portal_errors.ts
 * @description The error that the portal service throws when no portal has the given alias.
 * @architectural-layer Portal
 * @related-files [packages/portal/src/portal.ts, apps/exactl/src/command_builders/command_failure.ts]
 */

/** No portal has the alias. */
export class PortalNotFoundError extends Error {
  constructor(readonly alias: string) {
    super(`Portal '${alias}' not found`);
    this.name = "PortalNotFoundError";
  }
}
