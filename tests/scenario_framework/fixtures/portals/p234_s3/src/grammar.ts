/** One parsed token. */
export interface IToken {
  key: string;
  value: string;
}

/** The independent grammar for `key=value; key=value` strings. Whitespace is trimmed. */
export function parseWithGrammar(input: string): IToken[] {
  return input
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const index = part.indexOf("=");
      if (index < 0) throw new Error(`Missing '=' in token: ${part}`);
      return { key: part.slice(0, index).trim(), value: part.slice(index + 1).trim() };
    });
}
