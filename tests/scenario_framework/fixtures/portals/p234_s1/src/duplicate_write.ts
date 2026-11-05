/** A write log for the duplicate-write diagnosis case. */
export interface IWriteLog {
  rows: string[];
}

/** Appends one value. The defect appends it twice. */
export function recordWrite(log: IWriteLog, value: string): void {
  log.rows.push(value);
  log.rows.push(value);
}

/** Parses the config. An empty file reaches this function as null. */
export function parseConfig(raw: string | null): Record<string, string> {
  return JSON.parse(raw as string);
}
