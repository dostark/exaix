/** Retry policy for one operation. */
export interface IRetryPolicy {
  maxAttempts: number;
}

/** Runs an operation until it succeeds or the attempt budget is exhausted. */
export async function runWithRetry(
  operation: () => Promise<boolean>,
  policy: IRetryPolicy,
): Promise<{ ok: boolean; attempts: number }> {
  let attempts = 0;
  while (attempts < policy.maxAttempts) {
    attempts++;
    if (await operation()) return { ok: true, attempts };
  }
  return { ok: false, attempts };
}

/** Authorizes one write. A denied write must not call the writer. */
export function authorizeWrite(role: string): boolean {
  return role === "writer";
}
