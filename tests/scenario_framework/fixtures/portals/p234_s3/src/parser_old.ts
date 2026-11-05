import type { IToken } from "./grammar.ts";

/** Splits on ';' and leaves whitespace in place. */
export function parseOld(input: string): IToken[] {
  return input.split(";").filter((part) => part.length > 0).map((part) => {
    const index = part.indexOf("=");
    return { key: part.slice(0, index), value: part.slice(index + 1) };
  });
}
