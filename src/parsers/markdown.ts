/**
 * @module FrontmatterParserShim
 * @path src/parsers/markdown.ts
 * @description Compatibility shim for the @exaix/parsing package.
 * @architectural-layer Parsers
 * @related-files [packages/parsing/src/markdown.ts]
 */
import { FrontmatterParser as ParsingFrontmatterParser } from "@exaix/parsing";
import type { IParsedRequest as IParsedRequestFromParsing } from "@exaix/parsing";

export type IParsedRequest = IParsedRequestFromParsing;
export const FrontmatterParser = ParsingFrontmatterParser;
