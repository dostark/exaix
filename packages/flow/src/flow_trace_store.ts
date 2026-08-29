/**
 * @module FlowTraceStore
 * @path packages/flow/src/flow_trace_store.ts
 * @description Durable per-request parent trace id minting for `session_delegate_cycle`
 *   flows (Phase 174 Step 2 GAP-4). A cycle flow requires a stable UUID trace across
 *   retry/restart; when the caller omits `traceId`, `FlowRunner.execute` mints one keyed
 *   by `requestId` and reuses it on every subsequent call for the same request.
 * @architectural-layer Flows
 * @dependencies [@std/path, @std/fs]
 * @related-files [packages/flow/src/flow_runner.ts]
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";

export interface IFlowTraceStore {
  /** Returns the durable trace id for `requestId`, minting and persisting one on first call. */
  getOrCreate(requestId: string): Promise<string>;
}

interface IFlowTraceRecord {
  requestId: string;
  traceId: string;
  createdAt: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when `value` is a syntactically valid (RFC 4122) UUID string. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** File-backed IFlowTraceStore under `<rootDir>/<requestId>.json`. */
export class FlowTraceStore implements IFlowTraceStore {
  constructor(private readonly rootDir: string) {}

  async getOrCreate(requestId: string): Promise<string> {
    const filePath = join(this.rootDir, `${requestId}.json`);
    try {
      const raw = await Deno.readTextFile(filePath);
      const record = JSON.parse(raw) as IFlowTraceRecord;
      if (record.traceId && isUuid(record.traceId)) return record.traceId;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }

    const traceId = crypto.randomUUID();
    await ensureDir(this.rootDir);
    const record: IFlowTraceRecord = { requestId, traceId, createdAt: new Date().toISOString() };
    const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    await Deno.writeTextFile(tmpPath, JSON.stringify(record, null, 2));
    await Deno.rename(tmpPath, filePath);
    return traceId;
  }
}
