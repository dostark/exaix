/**
 * @module SessionBriefReader
 * @path packages/session/src/session_brief_reader.ts
 * @description Phase 174 Step 1 validated, package-pure brief reader used by
 *   post-reconcile dispatch and legacy crash recovery after event redaction.
 * @architectural-layer Services
 * @dependencies [@std/path, @exaix/schemas]
 * @related-files [packages/session/src/session_delegate_service.ts, apps/daemon/src/recovery.ts]
 */

import { join } from "@std/path";
import { SessionBriefSchema } from "@exaix/schemas/session_delegate.ts";
import type { SessionBrief } from "@exaix/schemas/session_delegate.ts";

export interface ISessionBriefReader {
  read(traceId: string): Promise<SessionBrief>;
}

const BRIEF_FILE = "brief.json";

export class SessionBriefReader implements ISessionBriefReader {
  constructor(private readonly sessionDir: string) {}

  async read(traceId: string): Promise<SessionBrief> {
    try {
      const brief = SessionBriefSchema.strict().parse(
        JSON.parse(await Deno.readTextFile(join(this.sessionDir, traceId, BRIEF_FILE))),
      );
      if (brief.trace_id !== traceId) throw new Error("trace mismatch");
      return brief;
    } catch {
      throw new Error("delegation brief is unavailable or invalid");
    }
  }
}
