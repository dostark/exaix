/** Joins two parts. This helper is private, so a refactor may rename it. */
function joinParts(left: string, right: string): string {
  return `${left}-${right}`;
}

/** Public label contract. The output must not change when the private helper is renamed. */
export function buildLabel(id: string, region: string): string {
  return joinParts(id, region);
}
