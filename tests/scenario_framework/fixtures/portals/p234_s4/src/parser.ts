/** One parsed key/value token. */
export interface IToken {
  key: string;
  value: string;
}

/** Parses `key=value`. Malformed input throws. */
export function parseToken(input: string): IToken {
  const index = input.indexOf("=");
  if (index <= 0) throw new Error("Malformed token");
  return { key: input.slice(0, index), value: input.slice(index + 1) };
}
