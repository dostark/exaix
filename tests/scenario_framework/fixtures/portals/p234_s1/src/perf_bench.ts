/** Runs one latency workload for a worker count. */
export function runWorkload(workers: number): number {
  const start = performance.now();
  for (let index = 0; index < workers * 2_000; index++) {
    Math.sqrt(index);
  }
  return performance.now() - start;
}
