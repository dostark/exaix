import type { IToken } from "./grammar.ts";

/** Splits on ';' and trims each part. */
export function parseNew(input: string): IToken[] {
  return input.split(";").map((part) => part.trim()).filter((part) => part.length > 0).map((part) => {
    const index = part.indexOf("=");
    return { key: part.slice(0, index).trim(), value: part.slice(index + 1).trim() };
  });
}
